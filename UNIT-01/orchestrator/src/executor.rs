use crate::clients::indexer::IndexerClient;
use crate::clients::sandbox::SandboxClient;
use crate::mcp::MCPManager;
use crate::workspace::Workspace;
use serde_json::Value;
use std::path::Path;

pub async fn execute_tool(
    name: &str,
    args: &serde_json::Map<String, Value>,
    ws: &Workspace,
    mcp: &MCPManager,
) -> String {
    let args = resolve_paths(name, args, ws);

    let result = match name {
        "indexer_ls" | "list_files" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let client = IndexerClient::new();
            match client.list(path).await {
                Ok(list) => {
                    let mut out = format!("Contents of {}:\n", path);
                    for e in &list.entries {
                        let prefix = if e.entry_type == "dir" {
                            "  d "
                        } else {
                            "  f "
                        };
                        out.push_str(&format!("{} {}\n", prefix, e.name));
                    }
                    out
                }
                Err(_) => fallback_list(path),
            }
        }

        "indexer_read" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let client = IndexerClient::new();
            match client.read(path).await {
                Ok(content) => content,
                Err(_) => {
                    std::fs::read_to_string(path).unwrap_or_else(|e| format!("❌ ERROR: {}", e))
                }
            }
        }

        "search" => {
            let query = args
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let client = IndexerClient::new();
            match client.search(query).await {
                Ok(records) if records.is_empty() => "🔍 No results found.".to_string(),
                Ok(records) => {
                    let mut out = format!("🔍 Search results for '{}':\n", query);
                    for r in &records {
                        out.push_str(&format!(
                            "  {}  ({} , {}b)\n",
                            r.path, r.language, r.size_bytes
                        ));
                    }
                    out
                }
                Err(e) => format!("❌ ERROR: {}", e),
            }
        }

        "execute" | "sandbox_exec" => {
            let cmd = args
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let client = SandboxClient::new();
            match client.execute(cmd).await {
                Ok(out) => out,
                Err(e) => format!("❌ ERROR: {}", e),
            }
        }

        "write" | "sandbox_write" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let content = extract_content(&args);
            let client = IndexerClient::new();
            match client.write(path, &content).await {
                Ok(()) => format!("✅ SUCCESS: File written at {}", path),
                Err(_) => {
                    if let Some(parent) = Path::new(path).parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    match std::fs::write(path, &content) {
                        Ok(()) => format!("✅ SUCCESS: File written at {}", path),
                        Err(e) => format!("❌ ERROR: Write failed: {}", e),
                    }
                }
            }
        }

        "patch" | "sandbox_patch" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let target = args
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let replacement = args
                .get("replacement")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let client = IndexerClient::new();
            match client.patch(path, target, replacement).await {
                Ok(status) => format!("✅ SUCCESS: {}", status),
                Err(e) => format!("❌ ERROR: {}", e),
            }
        }

        "delete" | "sandbox_delete" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let client = IndexerClient::new();
            match client.delete(path).await {
                Ok(status) => format!("✅ SUCCESS: {}", status),
                Err(_) => {
                    match std::fs::remove_dir_all(path).or_else(|_| std::fs::remove_file(path)) {
                        Ok(()) => format!("✅ SUCCESS: Deleted {}", path),
                        Err(e) => format!("❌ ERROR: {}", e),
                    }
                }
            }
        }

        "rollback" | "sandbox_rollback" => {
            let client = IndexerClient::new();
            match client.rollback().await {
                Ok(status) => format!("✅ SUCCESS: {}", status),
                Err(e) => format!("❌ ERROR: {}", e),
            }
        }

        "glob" => {
            let pattern = args
                .get("pattern")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let base = args.get("base").and_then(|v| v.as_str()).unwrap_or("");
            let client = IndexerClient::new();
            match client.glob(pattern, base).await {
                Ok(files) if files.is_empty() => format!("📁 No files match '{}'", pattern),
                Ok(files) => files.join("\n"),
                Err(e) => format!("❌ ERROR: {}", e),
            }
        }

        "find" => {
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let root = args.get("root").and_then(|v| v.as_str()).unwrap_or("");
            let client = IndexerClient::new();
            match client.find(name, root).await {
                Ok(files) if files.is_empty() => format!("🔍 No files named '{}'", name),
                Ok(files) => files.join("\n"),
                Err(e) => format!("❌ ERROR: {}", e),
            }
        }

        _ => {
            if mcp.has_tool(name).await {
                let params = serde_json::Value::Object(args.clone());
                mcp.execute_tool(name, params)
                    .await
                    .unwrap_or_else(|| format!("❌ MCP tool '{}' returned no result", name))
            } else {
                format!("❌ Unknown tool: {}", name)
            }
        }
    };

    result
}

fn extract_content(args: &serde_json::Map<String, Value>) -> String {
    for key in &[
        "content",
        "target",
        "content_data",
        "data",
        "text",
        "body",
        "html",
        "code",
    ] {
        if let Some(v) = args.get(*key) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() {
                    return s.replace("\\n", "\n");
                }
            }
        }
    }
    String::new()
}

fn fallback_list(path: &str) -> String {
    match std::fs::read_dir(path) {
        Ok(entries) => {
            let mut out = format!("Contents of {}:\n", path);
            for entry in entries.flatten() {
                let prefix = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    "  d "
                } else {
                    "  f "
                };
                out.push_str(&format!(
                    "{} {}\n",
                    prefix,
                    entry.file_name().to_string_lossy()
                ));
            }
            out
        }
        Err(e) => format!("❌ ERROR: {}", e),
    }
}

fn resolve_paths(
    name: &str,
    args: &serde_json::Map<String, Value>,
    ws: &Workspace,
) -> serde_json::Map<String, Value> {
    if !ws.active {
        return args.clone();
    }

    let path_keys = ["path", "cwd", "base", "root", "from", "to"];
    let mut resolved = args.clone();

    for key in &path_keys {
        if let Some(v) = resolved.get(*key) {
            if let Some(s) = v.as_str() {
                if !s.is_empty() && !s.starts_with('/') {
                    let abs = format!("{}/{}", ws.path.trim_end_matches('/'), s);
                    resolved.insert(key.to_string(), Value::String(abs));
                }
            }
        }
    }

    resolved
}

fn is_tool_error(result: &str) -> bool {
    let first = result.lines().next().unwrap_or("").to_lowercase();
    first.starts_with("error") || first.starts_with("❌")
}
