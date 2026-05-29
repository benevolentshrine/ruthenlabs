use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Deserialize)]
pub struct MCPConfig {
    #[serde(rename = "mcpServers")]
    pub mcp_servers: HashMap<String, MCPServerConfig>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MCPServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MCPTool {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MCPToolResult {
    pub content: Vec<MCPContentItem>,
    #[serde(default)]
    pub is_error: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MCPContentItem {
    #[serde(rename = "type")]
    pub item_type: String,
    #[serde(default)]
    pub text: String,
}

struct MCPServerInstance {
    name: String,
    child: Child,
    stdin: tokio::io::BufWriter<tokio::process::ChildStdin>,
    stdout: BufReader<tokio::process::ChildStdout>,
    seq_no: u32,
}

impl MCPServerInstance {
    async fn send_request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        self.seq_no += 1;
        let id = self.seq_no;

        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
            "id": id
        });

        let data = serde_json::to_vec(&req).map_err(|e| format!("serialize: {}", e))?;
        let header = format!("Content-Length: {}\r\n\r\n", data.len());
        let mut full = header.into_bytes();
        full.extend(data);

        self.stdin
            .write_all(&full)
            .await
            .map_err(|e| format!("write: {}", e))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| format!("flush: {}", e))?;

        let mut line = String::new();
        loop {
            line.clear();
            match self.stdout.read_line(&mut line).await {
                Ok(0) => return Err("connection closed".to_string()),
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if let Ok(resp) = serde_json::from_str::<Value>(trimmed) {
                        if resp.get("id").and_then(|v| v.as_u64()) == Some(id as u64) {
                            if let Some(err) = resp.get("error") {
                                return Err(format!("MCP error: {}", err));
                            }
                            if let Some(result) = resp.get("result") {
                                return Ok(result.clone());
                            }
                        }
                    }
                }
                Err(e) => return Err(format!("read: {}", e)),
            }
        }
    }
}

pub struct MCPManager {
    servers: Mutex<HashMap<String, MCPServerInstance>>,
    tools: Mutex<HashMap<String, MCPToolRef>>,
}

#[derive(Clone)]
struct MCPToolRef {
    server_name: String,
    tool: MCPTool,
}

impl MCPManager {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
            tools: Mutex::new(HashMap::new()),
        }
    }

    pub async fn load_config(&self) {
        let config_path = if let Some(home) = home::home_dir() {
            format!("{}/.config/unit01/mcp.json", home.display())
        } else {
            return;
        };

        let data = match tokio::fs::read_to_string(&config_path).await {
            Ok(d) => d,
            Err(_) => return,
        };

        let cfg: MCPConfig = match serde_json::from_str(&data) {
            Ok(c) => c,
            Err(e) => {
                eprintln!("⚠️ MCP config parse error: {}", e);
                return;
            }
        };

        for (name, srv_cfg) in cfg.mcp_servers {
            match self.spawn_server(&name, &srv_cfg).await {
                Ok(()) => {}
                Err(e) => eprintln!("⚠️ MCP [{}] failed: {}", name, e),
            }
        }
    }

    async fn spawn_server(&self, name: &str, cfg: &MCPServerConfig) -> Result<(), String> {
        let mut cmd = Command::new(&cfg.command);
        cmd.args(&cfg.args);
        cmd.env_clear();
        cmd.envs(std::env::vars());
        for (k, v) in &cfg.env {
            cmd.env(k, v);
        }

        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::inherit());

        let mut child = cmd.spawn().map_err(|e| format!("spawn: {}", e))?;

        let stdin = child.stdin.take().ok_or("no stdin")?;
        let stdout = child.stdout.take().ok_or("no stdout")?;

        let mut instance = MCPServerInstance {
            name: name.to_string(),
            child,
            stdin: tokio::io::BufWriter::new(stdin),
            stdout: BufReader::new(stdout),
            seq_no: 0,
        };

        instance
            .send_request(
                "initialize",
                serde_json::json!({
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": { "name": "unit01", "version": "1.0" }
                }),
            )
            .await?;

        let tools_result = instance
            .send_request("tools/list", serde_json::json!(null))
            .await?;
        let tools_list: Vec<MCPTool> = serde_json::from_value(
            tools_result
                .get("tools")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![])),
        )
        .map_err(|e| format!("tool parse: {}", e))?;

        let mut servers = self.servers.lock().await;
        servers.insert(name.to_string(), instance);

        let mut tools = self.tools.lock().await;
        for tool in tools_list {
            tools.insert(
                tool.name.clone(),
                MCPToolRef {
                    server_name: name.to_string(),
                    tool,
                },
            );
        }

        Ok(())
    }

    pub async fn tool_count(&self) -> usize {
        self.tools.lock().await.len()
    }

    pub async fn tool_descriptions(&self) -> String {
        let tools = self.tools.lock().await;
        if tools.is_empty() {
            return String::new();
        }
        let mut desc = String::from("\n\n### MCP EXTENSIBLE TOOLS (available on this system):\n");
        for (_name, ref_) in tools.iter() {
            desc.push_str(&format!("- <{}>", ref_.tool.name));
            if !ref_.tool.description.is_empty() {
                desc.push_str(&format!(": {}", ref_.tool.description));
            }
            desc.push('\n');
        }
        desc
    }

    pub async fn execute_tool(&self, name: &str, args: Value) -> Option<String> {
        let tools = self.tools.lock().await;
        let ref_ = tools.get(name)?.clone();
        drop(tools);
        let mut servers = self.servers.lock().await;
        let instance = servers.get_mut(&ref_.server_name)?;

        match instance
            .send_request(
                "tools/call",
                serde_json::json!({
                    "name": name,
                    "arguments": args
                }),
            )
            .await
        {
            Ok(result) => {
                let tr: MCPToolResult = serde_json::from_value(result).ok()?;
                let mut text = String::new();
                for item in tr.content {
                    text.push_str(&item.text);
                }
                Some(text)
            }
            Err(_) => None,
        }
    }

    pub async fn has_tool(&self, name: &str) -> bool {
        self.tools.lock().await.contains_key(name)
    }

    pub async fn shutdown(&self) {
        let mut servers = self.servers.lock().await;
        for (_name, instance) in servers.iter_mut() {
            let _ = instance.child.kill().await;
        }
        servers.clear();
    }
}
