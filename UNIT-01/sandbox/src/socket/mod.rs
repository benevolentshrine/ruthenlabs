//! SANDBOX Socket — Pure Execution Bodyguard
//!
//! The sandbox daemon is stripped down to a pure Command Execution service.
//! File editing, patching, and backups are handled by the Go Orchestrator.
//! This daemon runs processes under kernel isolation and returns LLM-readable
//! directive reports.

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Shared daemon state across all connections.
struct DaemonState {
    /// Active workspace path. Execution is scoped here when set.
    workspace: Option<PathBuf>,
    /// Active security mode: Lock/Run/Root
    security_mode: String,
}

impl DaemonState {
    fn new() -> Self {
        Self {
            workspace: None,
            security_mode: "run".to_string(),
        }
    }
}

type SharedState = Arc<Mutex<DaemonState>>;

/// Socket configuration
pub mod config;
/// Ecosystem integration
pub mod ecosystem;
/// Socket stubs for INDEXER and ORCHESTRATOR
pub mod stubs;

/// Maximum request size: 10MB
const MAX_REQUEST_SIZE: usize = config::MAX_REQUEST_SIZE;

/// Run the socket daemon
pub async fn run_daemon(socket_path: Option<PathBuf>) -> Result<()> {
    let path = socket_path.unwrap_or_else(config::sandbox_socket_path);

    tracing::info!("Starting SANDBOX socket daemon on {:?}", path);

    #[cfg(unix)]
    {
        run_unix_daemon(path).await
    }

    #[cfg(windows)]
    {
        let _ = path;
        run_named_pipe_daemon().await
    }
}

#[cfg(unix)]
async fn run_unix_daemon(path: PathBuf) -> Result<()> {
    use tokio::net::UnixListener;

    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let socket_path = config::sandbox_socket_path();
    tracing::info!("Starting SANDBOX socket daemon on {:?}", socket_path);

    if path.exists() {
        tokio::fs::remove_file(&path)
            .await
            .with_context(|| format!("Failed to remove old socket at {:?}", path))?;
    }
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                tracing::error!(
                    "[FATAL] Socket bind denied at {}.",
                    config::sandbox_socket_path().display()
                );
                std::process::exit(2);
            }
            return Err(e.into());
        }
    };
    tracing::info!("Socket daemon listening on {:?}", path);

    let state: SharedState = Arc::new(Mutex::new(DaemonState::new()));

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let state = state.clone();
                tokio::spawn(handle_unix_connection(stream, state));
            }
            Err(e) => {
                tracing::error!("Failed to accept connection: {}", e);
            }
        }
    }
}

#[cfg(unix)]
async fn handle_unix_connection(
    mut stream: tokio::net::UnixStream,
    state: SharedState,
) -> Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    let mut reader = BufReader::new(&mut stream);
    let mut line = String::new();

    let n = reader
        .read_line(&mut line)
        .await
        .context("Failed to read from socket")?;

    if n == 0 {
        return Ok(());
    }

    let response = process_request(line.as_bytes(), &state).await?;

    let mut response_bytes = serde_json::to_vec(&response)?;
    response_bytes.push(b'\n');

    stream.write_all(&response_bytes).await?;
    stream.flush().await?;

    Ok(())
}

#[cfg(windows)]
async fn run_named_pipe_daemon() -> Result<()> {
    use tokio::net::TcpListener;

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let local_addr = listener.local_addr()?;
    tracing::info!(
        "Socket daemon listening on TCP {} (Windows named pipe substitute)",
        local_addr
    );

    let info_path = std::env::temp_dir().join("sandbox").join("socket.info");
    if let Some(parent) = info_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let _ = tokio::fs::write(&info_path, format!("{}", local_addr.port())).await;

    let state: SharedState = Arc::new(Mutex::new(DaemonState::new()));

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let state = state.clone();
                tokio::spawn(handle_tcp_connection(stream, state));
            }
            Err(e) => {
                tracing::error!("Failed to accept connection: {}", e);
            }
        }
    }
}

#[cfg(windows)]
async fn handle_tcp_connection(
    mut stream: tokio::net::TcpStream,
    state: SharedState,
) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buffer = vec![0u8; MAX_REQUEST_SIZE];
    let n: usize = stream
        .read(&mut buffer[..])
        .await
        .context("Failed to read from stream")?;

    if n == 0 {
        return Ok(());
    }

    buffer.truncate(n);

    let response = process_request(&buffer, &state).await?;

    let response_bytes = serde_json::to_vec(&response)?;
    stream.write_all(&response_bytes).await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;

    Ok(())
}

/// Process an execute request — the only remaining directive.
async fn process_request(buffer: &[u8], state: &SharedState) -> Result<JsonRpcResponse> {
    let request: JsonRpcRequest = match serde_json::from_slice(buffer) {
        Ok(req) => req,
        Err(e) => {
            return Ok(JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError {
                    code: -32700,
                    message: format!("Parse error: {}", e),
                }),
                id: serde_json::Value::Null,
            });
        }
    };

    tracing::info!("Received request {} of type {}", request.id, request.method);

    let response = match request.method.as_str() {
        "cage_execute" | "execute" => handle_execute(request, state).await,
        "set_workspace" => handle_set_workspace(request, state).await,
        "set_policy" => handle_set_policy(request, state).await,
        _ => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code: -32601,
                message: format!("Method not found: {}", request.method),
            }),
            id: request.id,
        },
    };
    Ok(response)
}

/// Execute a command inside the kernel sandbox (Landlock + Seccomp + Cgroups).
async fn handle_execute(request: JsonRpcRequest, state: &SharedState) -> JsonRpcResponse {
    let audit_id = uuid::Uuid::new_v4();

    // Resolve command and working directory
    let cmd = request
        .params
        .get("cmd")
        .and_then(|v| v.as_str())
        .or_else(|| request.params.get("command").and_then(|v| v.as_str()));

    if let Some(shell_cmd) = cmd {
        let ws_state = state.lock().await;
        let workspace = ws_state
            .workspace
            .clone()
            .unwrap_or_else(|| PathBuf::from("."));
        let mode_str = ws_state.security_mode.clone();
        drop(ws_state);

        let mode = crate::cage::policy::SecurityMode::from(mode_str.as_str());

        let sandbox_opts = crate::cage::sandbox::SandboxOptions::default();

        let mut command = std::process::Command::new("sh");
        command
            .arg("-c")
            .arg(shell_cmd)
            .current_dir(&workspace)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let child = match crate::cage::sandbox::spawn_sandboxed_command(
            command,
            &workspace,
            sandbox_opts,
            mode,
        ) {
            Ok(c) => c,
            Err(e) => {
                return JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32000,
                        message: format!("Sandbox spawn failed: {}", e),
                    }),
                    id: request.id,
                };
            }
        };

        let output = match child.wait_with_output() {
            Ok(out) => out,
            Err(e) => {
                return JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32000,
                        message: format!("Failed to collect output: {}", e),
                    }),
                    id: request.id,
                };
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let exit_code = output.status.code().unwrap_or(-1);

        // Check for sandbox violations via signal
        use std::os::unix::process::ExitStatusExt;
        let violation = if let Some(signal) = output.status.signal() {
            match signal {
                31 => Some(format!(
                    "❌ Sandbox Violation: Seccomp blocked a prohibited syscall (signal 31). \
                     Directive: Modify your command to run within [{}] without external \
                     network requests, or ask the user to elevate to 'Root' mode.",
                    workspace.display()
                )),
                9 => Some(
                    "❌ Sandbox Violation: Process killed by SIGKILL (OOM or EDR). \
                     Directive: Reduce memory usage or ask the user to elevate to 'Root' mode."
                        .to_string(),
                ),
                6 => Some(
                    "❌ Sandbox Violation: Process aborted (signal 6). \
                     Directive: Check your command logic."
                        .to_string(),
                ),
                other => Some(format!(
                    "❌ Sandbox Violation: Process terminated by signal {} inside sandbox. \
                     Directive: Modify your command to run within [{}] or ask the user to \
                     elevate to 'Root' mode.",
                    other,
                    workspace.display()
                )),
            }
        } else if !output.status.success() {
            // Non-zero exit but no signal — could be Landlock file write block (EACCES)
            if exit_code == 1
                && (stderr.contains("Permission denied")
                    || stderr.contains("EACCES")
                    || stderr.contains("Operation not permitted"))
            {
                Some(format!(
                    "❌ Sandbox Violation: Filesystem write blocked. \
                     Directive: Write operations are restricted to [{}] in 'Run' mode. \
                     Ask the user to elevate to 'Root' mode for wider access.",
                    workspace.display()
                ))
            } else if exit_code == 13 {
                Some(format!(
                    "❌ Sandbox Violation: Landlock blocked a filesystem operation (exit code 13). \
                     Directive: Keep file operations within [{}] or ask the user to elevate.",
                    workspace.display()
                ))
            } else {
                None
            }
        } else {
            None
        };

        if let Some(violation_msg) = violation {
            return JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: Some(ExecuteResult {
                    verdict: format!("STDOUT:\n{}\nSTDERR:\n{}", stdout, stderr),
                    audit_ref: audit_id.to_string(),
                }),
                error: Some(JsonRpcError {
                    code: 1000,
                    message: violation_msg,
                }),
                id: request.id,
            };
        }

        return JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: format!("STDOUT:\n{}\nSTDERR:\n{}", stdout, stderr),
                audit_ref: audit_id.to_string(),
            }),
            error: None,
            id: request.id,
        };
    }

    // Fallback: WASM execution via cage
    let code_b64 = request
        .params
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let code_bytes = match decode_base64(code_b64) {
        Ok(bytes) => bytes,
        Err(e) => {
            return JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError {
                    code: -32602,
                    message: format!("Invalid params: Failed to decode base64: {}", e),
                }),
                id: request.id,
            };
        }
    };

    let temp_dir = std::env::temp_dir().join("sandbox").join("workspace");
    let _ = tokio::fs::create_dir_all(&temp_dir).await;
    let temp_file = temp_dir.join(format!("{}.wasm", request.id));

    if let Err(e) = tokio::fs::write(&temp_file, &code_bytes).await {
        return JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code: -32000,
                message: format!("Server error: Failed to write temp file: {}", e),
            }),
            id: request.id,
        };
    }

    let policy_str = request
        .params
        .get("policy")
        .and_then(|v| v.as_str())
        .unwrap_or("strict")
        .to_string();
    let path = temp_file.clone();

    let verdict = tokio::task::spawn_blocking(move || {
        crate::cage::run_cage(
            path,
            crate::cage::policy::SecurityMode::from(policy_str.as_str()),
            None,
        )
        .map(|r| r.verdict)
    })
    .await
    .unwrap_or_else(|e| Err(anyhow::anyhow!("Execution panicked: {}", e)));

    let _ = tokio::fs::remove_file(&temp_file).await;

    match verdict {
        Ok(crate::cage::verdict::Verdict::Allowed { .. }) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: "ALLOWED".to_string(),
                audit_ref: audit_id.to_string(),
            }),
            error: None,
            id: request.id,
        },
        Ok(crate::cage::verdict::Verdict::Blocked { reason }) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: "BLOCKED".to_string(),
                audit_ref: audit_id.to_string(),
            }),
            error: Some(JsonRpcError {
                code: 1000,
                message: reason,
            }),
            id: request.id,
        },
        Ok(crate::cage::verdict::Verdict::Timeout) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: "BLOCKED".to_string(),
                audit_ref: audit_id.to_string(),
            }),
            error: Some(JsonRpcError {
                code: 1001,
                message: "Timeout: fuel exhausted".to_string(),
            }),
            id: request.id,
        },
        Ok(crate::cage::verdict::Verdict::Quarantined { reason }) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: "BLOCKED".to_string(),
                audit_ref: audit_id.to_string(),
            }),
            error: Some(JsonRpcError {
                code: 1002,
                message: format!("Quarantined: {}", reason),
            }),
            id: request.id,
        },
        Ok(crate::cage::verdict::Verdict::Unsupported { reason }) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: "BLOCKED".to_string(),
                audit_ref: audit_id.to_string(),
            }),
            error: Some(JsonRpcError {
                code: 1003,
                message: format!("Unsupported: {}", reason),
            }),
            id: request.id,
        },
        Ok(crate::cage::verdict::Verdict::Error { message }) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: "BLOCKED".to_string(),
                audit_ref: audit_id.to_string(),
            }),
            error: Some(JsonRpcError {
                code: -32000,
                message,
            }),
            id: request.id,
        },
        Err(e) => JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code: -32000,
                message: format!("Execution error: {}", e),
            }),
            id: request.id,
        },
    }
}

/// Set the active workspace directory and security mode.
async fn handle_set_workspace(request: JsonRpcRequest, state: &SharedState) -> JsonRpcResponse {
    let path_str = request.params.get("path").and_then(|v| v.as_str());

    if let Some(path) = path_str {
        let workspace = PathBuf::from(path);
        if !workspace.exists() || !workspace.is_dir() {
            return error_response(
                request.id,
                -32602,
                &format!(
                    "Invalid workspace: {} (must be an existing directory)",
                    path
                ),
            );
        }

        let mut daemon_state = state.lock().await;
        daemon_state.workspace = Some(workspace);
        let sid = uuid::Uuid::new_v4().to_string();
        drop(daemon_state);

        tracing::info!("Workspace set to: {} (session: {})", path, sid);

        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: Some(ExecuteResult {
                verdict: format!("Workspace set to: {}", path),
                audit_ref: sid,
            }),
            error: None,
            id: request.id,
        }
    } else {
        error_response(request.id, -32602, "Missing 'path' parameter")
    }
}

/// Set the security policy mode: lock (Hard), run (Mid), root (Audit).
async fn handle_set_policy(request: JsonRpcRequest, state: &SharedState) -> JsonRpcResponse {
    let mode = request
        .params
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("run");

    let valid_modes = ["lock", "run", "root"];
    if !valid_modes.contains(&mode) {
        return error_response(
            request.id,
            -32602,
            &format!("Invalid mode '{}'. Must be one of: lock, run, root", mode),
        );
    }

    // Map legacy names to SecurityMode enum values used by cage::policy::From<&str>
    let internal_mode = match mode {
        "lock" => "hard",
        "root" => "audit",
        _ => "mid", // "run" → Mid (default)
    };

    let mut daemon_state = state.lock().await;
    daemon_state.security_mode = internal_mode.to_string();
    drop(daemon_state);

    tracing::info!(
        "Security mode set to: {} (mapped from {})",
        internal_mode,
        mode
    );

    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: Some(ExecuteResult {
            verdict: format!(
                "Security mode set to: {} (mapped from {})",
                internal_mode, mode
            ),
            audit_ref: uuid::Uuid::new_v4().to_string(),
        }),
        error: None,
        id: request.id,
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

fn error_response(id: serde_json::Value, code: i32, message: &str) -> JsonRpcResponse {
    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: None,
        error: Some(JsonRpcError {
            code,
            message: message.to_string(),
        }),
        id,
    }
}

/// JSON-RPC 2.0 Request
#[derive(Debug, serde::Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub method: String,
    pub params: serde_json::Value,
    pub id: serde_json::Value,
}

#[derive(Debug, serde::Deserialize)]
pub struct ExecutePayload {
    pub code: String,
    #[allow(dead_code)]
    pub format: String,
    pub policy: String,
}

/// JSON-RPC 2.0 Response
#[derive(Debug, serde::Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ExecuteResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
    pub id: serde_json::Value,
}

#[derive(Debug, serde::Serialize)]
pub struct ExecuteResult {
    pub verdict: String,
    pub audit_ref: String,
}

#[derive(Debug, serde::Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

/// Base64 decoding helper
fn decode_base64(s: &str) -> Result<Vec<u8>> {
    let mut result = Vec::with_capacity(s.len() * 3 / 4);
    let chars: Vec<u8> = s.bytes().collect();

    let decode_char = |c: u8| -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };

    for chunk in chars.chunks(4) {
        let b0 = chunk
            .first()
            .copied()
            .ok_or_else(|| anyhow::anyhow!("Invalid base64"))?;
        let b1 = chunk
            .get(1)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("Invalid base64"))?;

        let b = [
            decode_char(b0).ok_or_else(|| anyhow::anyhow!("Invalid base64 char"))?,
            decode_char(b1).ok_or_else(|| anyhow::anyhow!("Invalid base64 char"))?,
            chunk.get(2).and_then(|c| decode_char(*c)).unwrap_or(0),
            chunk.get(3).and_then(|c| decode_char(*c)).unwrap_or(0),
        ];

        result.push((b[0] << 2) | (b[1] >> 4));
        if chunk.len() > 2 && chunk[2] != b'=' {
            result.push((b[1] << 4) | (b[2] >> 2));
        }
        if chunk.len() > 3 && chunk[3] != b'=' {
            result.push((b[2] << 6) | b[3]);
        }
    }

    Ok(result)
}
