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
    /// Whether sandbox enforcement is active (binary: ON/OFF).
    sandbox_enabled: bool,
}

impl DaemonState {
    fn new() -> Self {
        Self {
            workspace: None,
            sandbox_enabled: true,
        }
    }
}

type SharedState = Arc<Mutex<DaemonState>>;

/// Socket paths and configuration
pub mod config;

/// Maximum request size: 10MB
#[allow(dead_code)]
const MAX_REQUEST_SIZE: usize = 10 * 1024 * 1024;

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
    drop(reader);

    let request: JsonRpcRequest = match serde_json::from_slice(line.as_bytes()) {
        Ok(req) => req,
        Err(e) => {
            let err = JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError {
                    code: -32700,
                    message: format!("Parse error: {}", e),
                }),
                id: serde_json::Value::Null,
            };
            let mut bytes = serde_json::to_vec(&err)?;
            bytes.push(b'\n');
            stream.write_all(&bytes).await?;
            stream.flush().await?;
            return Ok(());
        }
    };

    if request.method == "cage_execute_stream" || request.method == "execute_stream" {
        handle_execute_stream(&mut stream, request, state).await?;
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

#[allow(dead_code)]
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

/// Execute a command inside the kernel sandbox (Landlock + Seccomp).
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
        let sandbox_enabled = ws_state.sandbox_enabled;
        drop(ws_state);

        let sandbox_opts = crate::cage::sandbox::SandboxOptions::default();

        let args: Vec<String> = vec!["-c".to_string(), shell_cmd.to_string()];
        let child = match crate::cage::sandbox::spawn_sandboxed_command(
            "sh",
            &args,
            &workspace,
            sandbox_opts,
            sandbox_enabled,
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
                31 => Some(
                    "❌ Sandbox Violation: Seccomp blocked a privesc syscall (signal 31). \
                     Directive: Ask the user to elevate to 'Root' mode."
                        .to_string(),
                ),
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

    error_response(
        request.id,
        -32602,
        "Missing 'cmd' or 'command' parameter. Shell commands only — WASM is not supported.",
    )
}

/// Execute a command and stream output line-by-line.
/// Protocol: multiple JSON-RPC responses (type: stdout/stderr/exit), one per line.
async fn handle_execute_stream(
    stream: &mut tokio::net::UnixStream,
    request: JsonRpcRequest,
    state: SharedState,
) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    use std::io::BufRead;

    let cmd = request
        .params
        .get("cmd")
        .and_then(|v| v.as_str())
        .or_else(|| request.params.get("command").and_then(|v| v.as_str()));

    let Some(shell_cmd) = cmd else {
        let err = serde_json::to_vec(&JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(JsonRpcError {
                code: -32602,
                message: "Missing 'cmd' or 'command' parameter".to_string(),
            }),
            id: request.id.clone(),
        })?;
        let mut bytes = err;
        bytes.push(b'\n');
        stream.write_all(&bytes).await?;
        stream.flush().await?;
        return Ok(());
    };

    let ws_state = state.lock().await;
    let workspace = ws_state
        .workspace
        .clone()
        .unwrap_or_else(|| PathBuf::from("."));
    let sandbox_enabled = ws_state.sandbox_enabled;
    drop(ws_state);

    let sandbox_opts = crate::cage::sandbox::SandboxOptions::default();

    let args: Vec<String> = vec!["-c".to_string(), shell_cmd.to_string()];
    let sandboxed = match crate::cage::sandbox::spawn_sandboxed_command(
        "sh",
        &args,
        &workspace,
        sandbox_opts,
        sandbox_enabled,
    ) {
        Ok(c) => c,
        Err(e) => {
            let err = serde_json::to_vec(&JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                result: None,
                error: Some(JsonRpcError {
                    code: -32000,
                    message: format!("Sandbox spawn failed: {}", e),
                }),
                id: request.id.clone(),
            })?;
            let mut bytes = err;
            bytes.push(b'\n');
            stream.write_all(&bytes).await?;
            stream.flush().await?;
            return Ok(());
        }
    };

    let mut child = sandboxed.take_child()?;
    let pid = child.id();
    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();
    let timeout_secs: u64 = request
        .params
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .map(|ms| ms / 1000)
        .unwrap_or(600);

    let (tx, mut rx) = tokio::sync::mpsc::channel::<(String, String)>(256);

    let tx_stdout = tx.clone();
    tokio::task::spawn_blocking(move || {
        if let Some(stdout) = stdout_handle {
            let reader = std::io::BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if tx_stdout.blocking_send(("stdout".to_string(), l)).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });

    let tx_stderr = tx.clone();
    tokio::task::spawn_blocking(move || {
        if let Some(stderr) = stderr_handle {
            let reader = std::io::BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(l) => {
                        if tx_stderr.blocking_send(("stderr".to_string(), l)).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });

    let (exit_tx, exit_rx) = std::sync::mpsc::channel();
    let timeout_killed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let killed = timeout_killed.clone();

    if timeout_secs > 0 {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(timeout_secs));
            killed.store(true, std::sync::atomic::Ordering::SeqCst);
            let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
            std::thread::sleep(std::time::Duration::from_secs(2));
            let _ = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
        });
    }

    std::thread::spawn(move || {
        let _ = child.wait();
        let _ = exit_tx.send(());
    });

    let id = request.id.clone();

    loop {
        tokio::select! {
            Some((stream_type, line)) = rx.recv() => {
                let msg = serde_json::json!({
                    "jsonrpc": "2.0",
                    "result": {
                        "type": stream_type,
                        "data": line,
                    },
                    "id": id,
                });
                let mut bytes = serde_json::to_vec(&msg)?;
                bytes.push(b'\n');
                stream.write_all(&bytes).await?;
                stream.flush().await?;
            }
            _ = tokio::task::yield_now() => {
                if exit_rx.try_recv().is_ok() {
                    break;
                }
            }
        }
    }

    let exit_code = if timeout_killed.load(std::sync::atomic::Ordering::SeqCst) {
        -1
    } else {
        0
    };

    let exit_msg = serde_json::json!({
        "jsonrpc": "2.0",
        "result": {
            "type": "exit",
            "code": exit_code,
        },
        "id": id,
    });
    let mut bytes = serde_json::to_vec(&exit_msg)?;
    bytes.push(b'\n');
    stream.write_all(&bytes).await?;
    stream.flush().await?;

    Ok(())
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

/// Toggle sandbox enforcement on/off.
async fn handle_set_policy(request: JsonRpcRequest, state: &SharedState) -> JsonRpcResponse {
    let enabled = request
        .params
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let mut daemon_state = state.lock().await;
    daemon_state.sandbox_enabled = enabled;
    drop(daemon_state);

    let status = if enabled { "enabled" } else { "disabled" };
    tracing::info!("Sandbox enforcement {}", status);

    JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: Some(ExecuteResult {
            verdict: format!("Sandbox enforcement {}", status),
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
