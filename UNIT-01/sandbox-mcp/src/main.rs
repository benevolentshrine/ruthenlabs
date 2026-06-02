use anyhow::{Context, Result};
use sandbox::cage::sandbox::{spawn_sandboxed_command, SandboxOptions};
use serde_json::Value;
use std::io::{self, BufRead, Write};
use std::process::Command;
use std::time::Instant;

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "sandbox-mcp";
const SERVER_VERSION: &str = "0.1.0";

fn main() -> Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("sandbox_mcp=info")
        .try_init();

    tracing::info!("Starting sandbox-mcp server over stdio");

    let stdin = io::stdin();
    let mut stdin = stdin.lock();
    let mut stdout = io::stdout();

    let mut input_buffer = String::new();

    loop {
        input_buffer.clear();
        let content_length = match read_content_length(&mut stdin, &mut input_buffer) {
            Some(len) => len,
            None => break,
        };

        let body = read_json_body(&mut stdin, content_length)?;
        let request: JsonRpcRequest = match serde_json::from_str(&body) {
            Ok(req) => req,
            Err(e) => {
                let resp = json_error(None, -32700, &format!("Parse error: {}", e));
                write_response(&mut stdout, &resp)?;
                continue;
            }
        };

        let response = handle_request(&request);
        write_response(&mut stdout, &response)?;
    }

    Ok(())
}

fn read_content_length(reader: &mut impl BufRead, buf: &mut String) -> Option<usize> {
    loop {
        buf.clear();
        if reader.read_line(buf).ok()? == 0 {
            return None;
        }
        let trimmed = buf.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(len_str) = trimmed.strip_prefix("Content-Length: ") {
            let len: usize = len_str.trim().parse().ok()?;
            loop {
                buf.clear();
                if reader.read_line(buf).ok()? == 0 {
                    return None;
                }
                if buf.trim().is_empty() {
                    break;
                }
            }
            return Some(len);
        }
    }
}

fn read_json_body(reader: &mut impl BufRead, length: usize) -> Result<String> {
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body)?;
    Ok(String::from_utf8(body)?)
}

fn write_response(writer: &mut impl Write, response: &Value) -> Result<()> {
    let json = serde_json::to_string(response)?;
    let header = format!("Content-Length: {}\r\n\r\n", json.len());
    writer.write_all(header.as_bytes())?;
    writer.write_all(json.as_bytes())?;
    writer.flush()?;
    Ok(())
}

fn handle_request(request: &JsonRpcRequest) -> Value {
    let id = request.id.clone();

    match request.method.as_str() {
        "initialize" => handle_initialize(id),
        "tools/list" => handle_tools_list(id),
        "tools/call" => {
            let tool_name = request
                .params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let args = request
                .params
                .get("arguments")
                .cloned()
                .unwrap_or(Value::Object(serde_json::Map::new()));
            handle_tool_call(id, tool_name, &args)
        }
        "notifications/initialized" => json_response(id, serde_json::json!({})),
        _ => json_error(
            Some(id),
            -32601,
            &format!("Method not found: {}", request.method),
        ),
    }
}

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

fn handle_initialize(id: Value) -> Value {
    let result = serde_json::json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": {
            "tools": {}
        },
        "serverInfo": {
            "name": SERVER_NAME,
            "version": SERVER_VERSION
        }
    });
    json_response(id, result)
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

fn handle_tools_list(id: Value) -> Value {
    let tools = serde_json::json!([
        {
            "name": "sandbox_execute",
            "description": "Execute code in the security cage (Landlock + Seccomp + Cgroups)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": { "type": "string", "description": "Source code to execute" },
                    "language": {
                        "type": "string",
                        "enum": ["python", "rust", "shell", "javascript", "go", "ruby", "php", "perl", "lua", "swift", "kotlin", "scala", "r", "powershell", "typescript"],
                        "description": "Programming language of the code"
                    },

                    "fuel": {
                        "type": "integer",
                        "description": "Maximum execution steps (optional)"
                    }
                },
                "required": ["code", "language"]
            }
        },
        {
            "name": "sandbox_scan",
            "description": "Scan code for malicious patterns and threats",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": { "type": "string", "description": "Source code to scan" },
                    "language": { "type": "string", "description": "Language hint (optional)" }
                },
                "required": ["code"]
            }
        }
    ]);

    let result = serde_json::json!({ "tools": tools });
    json_response(id, result)
}

// ---------------------------------------------------------------------------
// Tool Call Dispatcher
// ---------------------------------------------------------------------------

fn handle_tool_call(id: Value, name: &str, args: &Value) -> Value {
    let result = match name {
        "sandbox_execute" => tool_execute(args),
        "sandbox_scan" => tool_scan(args),
        _ => {
            return json_error(Some(id), -32602, &format!("Unknown tool: {}", name));
        }
    };

    match result {
        Ok(content) => {
            let response = serde_json::json!({
                "content": [{
                    "type": "text",
                    "text": content
                }]
            });
            json_response(id, response)
        }
        Err(e) => {
            let error_msg = format!("{}", e);
            let response = serde_json::json!({
                "content": [{
                    "type": "text",
                    "text": error_msg
                }],
                "isError": true
            });
            json_response(id, response)
        }
    }
}

// ---------------------------------------------------------------------------
// Tool: sandbox_execute
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct LanguageConfig {
    extension: &'static str,
    interpreter: &'static str,
    interpreter_args: Vec<&'static str>,
}

fn language_config(language: &str) -> Option<LanguageConfig> {
    match language {
        "python" => Some(LanguageConfig {
            extension: "py",
            interpreter: "python3",
            interpreter_args: vec![],
        }),
        "rust" => Some(LanguageConfig {
            extension: "rs",
            interpreter: "rustc",
            interpreter_args: vec![],
        }),
        "shell" => Some(LanguageConfig {
            extension: "sh",
            interpreter: "bash",
            interpreter_args: vec![],
        }),
        "javascript" | "js" => Some(LanguageConfig {
            extension: "js",
            interpreter: "node",
            interpreter_args: vec![],
        }),
        "typescript" | "ts" => Some(LanguageConfig {
            extension: "ts",
            interpreter: "node",
            interpreter_args: vec!["--loader", "ts-node/esm"],
        }),
        "go" => Some(LanguageConfig {
            extension: "go",
            interpreter: "go",
            interpreter_args: vec!["run"],
        }),
        "ruby" => Some(LanguageConfig {
            extension: "rb",
            interpreter: "ruby",
            interpreter_args: vec![],
        }),
        "php" => Some(LanguageConfig {
            extension: "php",
            interpreter: "php",
            interpreter_args: vec![],
        }),
        "perl" => Some(LanguageConfig {
            extension: "pl",
            interpreter: "perl",
            interpreter_args: vec![],
        }),
        "lua" => Some(LanguageConfig {
            extension: "lua",
            interpreter: "lua",
            interpreter_args: vec![],
        }),
        "swift" => Some(LanguageConfig {
            extension: "swift",
            interpreter: "swift",
            interpreter_args: vec![],
        }),
        "kotlin" => Some(LanguageConfig {
            extension: "kt",
            interpreter: "kotlin",
            interpreter_args: vec!["-script"],
        }),
        "scala" => Some(LanguageConfig {
            extension: "scala",
            interpreter: "scala",
            interpreter_args: vec![],
        }),
        "r" => Some(LanguageConfig {
            extension: "r",
            interpreter: "Rscript",
            interpreter_args: vec![],
        }),
        "powershell" | "ps1" => Some(LanguageConfig {
            extension: "ps1",
            interpreter: "pwsh",
            interpreter_args: vec![],
        }),
        _ => None,
    }
}

fn tool_execute(args: &Value) -> Result<String> {
    let code = args
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing required argument: code"))?;

    let language = args
        .get("language")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing required argument: language"))?;

    let _fuel = args.get("fuel").and_then(|v| v.as_u64());

    let cfg = language_config(language)
        .ok_or_else(|| anyhow::anyhow!("Unsupported language: {}", language))?;

    let tmp_dir = tempfile::tempdir().context("Failed to create temp directory")?;
    let file_path = tmp_dir.path().join(format!("script.{}", cfg.extension));
    std::fs::write(&file_path, code).context("Failed to write code to temp file")?;

    let workspace = std::env::temp_dir().join("ruthen-sandbox-mcp");
    std::fs::create_dir_all(&workspace).context("Failed to create workspace directory")?;

    let session_id = uuid::Uuid::new_v4().to_string();

    let start = Instant::now();

    let (program, spawn_args): (String, Vec<String>) = if language == "rust" {
        let binary_path = tmp_dir.path().join("script");
        let mut build = Command::new("rustc");
        build.arg(&file_path).arg("-o").arg(&binary_path);
        let build_output = build.output().context("Failed to compile Rust code")?;
        if !build_output.status.success() {
            let stderr = String::from_utf8_lossy(&build_output.stderr);
            return Ok(serde_json::to_string(&serde_json::json!({
                "stdout": "",
                "stderr": stderr,
                "exit_code": build_output.status.code().unwrap_or(-1),
                "duration_ms": start.elapsed().as_millis() as u64,
                "session_id": session_id
            }))?);
        }
        (binary_path.to_string_lossy().to_string(), vec![])
    } else {
        let mut all_args: Vec<String> = cfg.interpreter_args.iter().map(|s| s.to_string()).collect();
        all_args.push(file_path.to_string_lossy().to_string());
        (cfg.interpreter.to_string(), all_args)
    };

    let sandbox_opts = SandboxOptions::default();
    let child = spawn_sandboxed_command(&program, &spawn_args, &workspace, sandbox_opts, true)
        .context("Failed to spawn sandboxed command")?;

    let output = child
        .wait_with_output()
        .context("Failed to collect sandbox output")?;

    let duration_ms = start.elapsed().as_millis() as u64;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let exit_code = output.status.code().unwrap_or(-1);

    let result = serde_json::json!({
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "session_id": session_id
    });

    Ok(serde_json::to_string(&result)?)
}



// ---------------------------------------------------------------------------
// Tool: sandbox_scan
// ---------------------------------------------------------------------------

fn tool_scan(args: &Value) -> Result<String> {
    let code = args
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("Missing required argument: code"))?;

    let mut threats: Vec<serde_json::Value> = Vec::new();

    let code_lower = code.to_lowercase();
    let dangerous_patterns = [
        ("base64_decode", "Potentially obfuscated code", "medium"),
        (
            "eval(",
            "Use of eval() - arbitrary code execution risk",
            "high",
        ),
        (
            "exec(",
            "Use of exec() - arbitrary code execution risk",
            "high",
        ),
        ("system(", "Shell command execution", "high"),
        ("popen(", "Process execution", "high"),
        ("subprocess", "Process spawning", "medium"),
        ("os.environ", "Environment variable access", "low"),
    ];

    for (pattern, detail, severity) in &dangerous_patterns {
        if code_lower.contains(pattern) {
            let line = find_line_number(code, pattern);
            threats.push(serde_json::json!({
                "pattern": pattern,
                "severity": severity,
                "line": line,
                "detail": detail
            }));
        }
    }

    threats.sort_by(|a, b| {
        let a_sev = a["severity"].as_str().unwrap_or("low");
        let b_sev = b["severity"].as_str().unwrap_or("low");
        let order = |s: &str| match s {
            "critical" => 0,
            "high" => 1,
            "medium" => 2,
            "low" => 3,
            _ => 4,
        };
        order(a_sev).cmp(&order(b_sev))
    });

    let safe = threats.is_empty();

    let result = serde_json::json!({
        "threats": threats,
        "safe": safe
    });
    Ok(serde_json::to_string(&result)?)
}

fn find_line_number(code: &str, pattern: &str) -> u64 {
    for (i, line) in code.lines().enumerate() {
        if line.to_lowercase().contains(pattern) {
            return (i + 1) as u64;
        }
    }
    0
}

// ---------------------------------------------------------------------------
// JSON-RPC helpers
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct JsonRpcRequest {
    #[serde(default)]
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

fn json_response(id: Value, result: Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn json_error(id: Option<Value>, code: i32, message: &str) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": {
            "code": code,
            "message": message
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_config_all_supported() {
        for lang in &[
            "python",
            "rust",
            "shell",
            "javascript",
            "go",
            "ruby",
            "php",
            "perl",
            "lua",
            "swift",
            "kotlin",
            "scala",
            "r",
            "powershell",
        ] {
            assert!(
                language_config(lang).is_some(),
                "Language '{}' should have a config",
                lang
            );
        }
    }

    #[test]
    fn test_language_config_unsupported() {
        assert!(language_config("brainfuck").is_none());
        assert!(language_config("cobol").is_none());
    }

    #[test]
    fn test_find_line_number_found() {
        let code = "print('hello')\neval('danger')\nprint('world')";
        let line = find_line_number(code, "eval");
        assert_eq!(line, 2);
    }

    #[test]
    fn test_find_line_number_not_found() {
        let code = "print('hello')\nprint('world')";
        let line = find_line_number(code, "eval");
        assert_eq!(line, 0);
    }

    #[test]
    fn test_tool_scan_clean_code() {
        let args = serde_json::json!({
            "code": "print('hello world')",
            "language": "python"
        });
        let result = tool_scan(&args).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert!(parsed["safe"].as_bool().unwrap());
        assert!(parsed["threats"].as_array().unwrap().is_empty());
    }

    #[test]
    fn test_tool_scan_detects_danger() {
        let args = serde_json::json!({
            "code": "import os\nos.system('rm -rf /')",
            "language": "python"
        });
        let result = tool_scan(&args).unwrap();
        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert!(!parsed["safe"].as_bool().unwrap());
        let threats = parsed["threats"].as_array().unwrap();
        assert!(!threats.is_empty());

        let has_system = threats.iter().any(|t| {
            t["pattern"].as_str().unwrap_or("").contains("system(")
        });
        assert!(has_system, "Should detect dangerous patterns");
    }

    #[test]
    fn test_json_rpc_response_shape() {
        let id = serde_json::json!(1);
        let result = serde_json::json!({"ok": true});
        let resp = json_response(id.clone(), result);
        assert_eq!(resp["jsonrpc"], "2.0");
        assert_eq!(resp["id"], id);
        assert!(resp["result"]["ok"].as_bool().unwrap());
    }

    #[test]
    fn test_json_rpc_error_shape() {
        let id = serde_json::json!(1);
        let resp = json_error(Some(id), -32601, "Method not found");
        assert_eq!(resp["jsonrpc"], "2.0");
        assert_eq!(resp["error"]["code"], -32601);
        assert_eq!(resp["error"]["message"], "Method not found");
    }
}
