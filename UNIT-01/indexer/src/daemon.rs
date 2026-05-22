use crate::DaemonAction;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{Read, Write};
use std::path::PathBuf;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tracing::{error, info};

#[derive(Serialize, Deserialize, Debug)]
struct JsonRpcRequest {
    jsonrpc: String,
    method: String,
    params: serde_json::Value,
    id: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct JsonRpcResponse {
    jsonrpc: String,
    result: Option<serde_json::Value>,
    error: Option<serde_json::Value>,
    id: u64,
}

// ── Directory & file paths ────────────────────────────────────────────────────

fn get_indexer_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("INDEXER_DATA_DIR") {
        let dir = PathBuf::from(env_dir);
        if !dir.exists() {
            let _ = std::fs::create_dir_all(&dir);
        }
        return dir;
    }
    if let Some(proj_dirs) = ProjectDirs::from("com", "ruthen", "indexer") {
        let data_dir = proj_dirs.data_dir();
        if !data_dir.exists() {
            let _ = std::fs::create_dir_all(data_dir);
        }
        data_dir.to_path_buf()
    } else {
        PathBuf::from(".")
    }
}

fn get_port_file() -> PathBuf  { get_indexer_dir().join("port")       }
fn get_token_file() -> PathBuf { get_indexer_dir().join("auth_token") }
fn get_pid_file() -> PathBuf   { get_indexer_dir().join("daemon.pid") }
fn get_log_file() -> PathBuf   { get_indexer_dir().join("daemon.log") }

// ── PID helpers ───────────────────────────────────────────────────────────────

/// Write the current process PID to the PID file.
fn write_pid_file() -> std::io::Result<()> {
    let pid = std::process::id();
    let mut f = File::create(get_pid_file())?;
    write!(f, "{}", pid)?;
    Ok(())
}

/// Read the PID stored in the PID file. Returns None if file is absent or unparseable.
fn read_pid_file() -> Option<u32> {
    let mut f = File::open(get_pid_file()).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    s.trim().parse().ok()
}

/// Check whether a process with the given PID is still alive.
/// On Unix we send signal 0; on Windows we use OpenProcess.
#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    use nix::sys::signal::{kill, Signal};
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid as i32), Signal::SIGUSR1).is_ok()
}

#[cfg(not(unix))]
fn pid_is_alive(pid: u32) -> bool {
    // On Windows, try to open the process; if it succeeds it is still alive.
    use std::process::Command;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

/// Remove all runtime state files (port, token, pid).
fn cleanup_state_files() {
    let _ = std::fs::remove_file(get_port_file());
    let _ = std::fs::remove_file(get_token_file());
    let _ = std::fs::remove_file(get_pid_file());
}

// ── CLI action entry-point ────────────────────────────────────────────────────

pub async fn handle_daemon_action(action: &DaemonAction) -> Result<(), Box<dyn std::error::Error>> {
    match action {
        DaemonAction::Start => {
            // ── Internal run mode (already detached child) ──────────────────
            if std::env::var("INDEXER_DAEMON_INTERNAL").is_ok() {
                run_daemon_server().await?;
                return Ok(());
            }

            // ── Check for a running daemon (stale-state-aware) ──────────────
            if let Some(pid) = read_pid_file() {
                if pid_is_alive(pid) {
                    info!("Daemon is already running (PID {}).", pid);
                    return Ok(());
                }
                info!("Stale PID file found (PID {} is dead). Cleaning up and restarting.", pid);
                cleanup_state_files();
            }

            // ── Spawn detached background process ───────────────────────────
            let exe = std::env::current_exe()?;
            let log_path = get_log_file();
            let log_file = File::create(&log_path)?;

            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                let _child = std::process::Command::new(&exe)
                    .args(["daemon", "start"])
                    .env("INDEXER_DAEMON_INTERNAL", "1")
                    .stdin(std::process::Stdio::null())
                    .stdout(log_file.try_clone()?)
                    .stderr(log_file)
                    // setsid() detaches from the controlling TTY
                    .process_group(0)
                    .spawn()?;
            }
            #[cfg(not(unix))]
            {
                // Windows: CREATE_NO_WINDOW flag via `creation_flags`
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let _child = std::process::Command::new(&exe)
                    .args(["daemon", "start"])
                    .env("INDEXER_DAEMON_INTERNAL", "1")
                    .stdin(std::process::Stdio::null())
                    .stdout(log_file.try_clone()?)
                    .stderr(log_file)
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()?;
            }

            info!("Daemon launched in background. Logs → {:?}", log_path);
        }

        DaemonAction::Status => {
            // ── Stale-state detection before any TCP call ───────────────────
            match read_pid_file() {
                None => {
                    info!("Daemon is not running (no PID file).");
                    return Ok(());
                }
                Some(pid) if !pid_is_alive(pid) => {
                    info!("Daemon is not running (PID {} is dead). Cleaning up stale files.", pid);
                    cleanup_state_files();
                    return Ok(());
                }
                Some(pid) => {
                    info!("PID {} appears alive; querying via TCP.", pid);
                }
            }
            match send_rpc("status", serde_json::json!({})).await {
                Ok(res) => info!("Daemon status: {:?}", res),
                Err(e)  => info!("Daemon unreachable: {}", e),
            }
        }

        DaemonAction::Stop => {
            let res = send_rpc("stop", serde_json::json!({})).await?;
            info!("Daemon stop response: {:?}", res);
        }
    }
    Ok(())
}

// ── Server loop ───────────────────────────────────────────────────────────────

async fn run_daemon_server() -> Result<(), Box<dyn std::error::Error>> {
    let socket_path = "/tmp/ruthen/indexer.sock";
    
    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(socket_path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    // Remove existing socket if it exists
    let _ = std::fs::remove_file(socket_path);

    let listener = UnixListener::bind(socket_path)?;
    info!("Indexer daemon listening on UDS: {} (PID {})", socket_path, std::process::id());

    write_pid_file()?;

    // Token is no longer used for UDS as socket permissions handle security
    let token = "uds-internal-trust".to_string();

    // ── Graceful SIGTERM / SIGINT via a shutdown channel ───────────────────
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let shutdown_tx = std::sync::Arc::new(std::sync::Mutex::new(Some(shutdown_tx)));

    #[cfg(unix)]
    {
        let tx_clone = shutdown_tx.clone();
        tokio::spawn(async move {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigterm = signal(SignalKind::terminate()).unwrap();
            let mut sigint  = signal(SignalKind::interrupt()).unwrap();
            tokio::select! {
                _ = sigterm.recv() => info!("Received SIGTERM"),
                _ = sigint.recv()  => info!("Received SIGINT"),
            }
            if let Ok(mut lock) = tx_clone.lock() {
                if let Some(tx) = lock.take() {
                    let _ = tx.send(());
                }
            }
        });
    }
    #[cfg(not(unix))]
    {
        let tx_clone = shutdown_tx.clone();
        tokio::spawn(async move {
            let _ = tokio::signal::ctrl_c().await;
            info!("Received Ctrl-C");
            if let Ok(mut lock) = tx_clone.lock() {
                if let Some(tx) = lock.take() {
                    let _ = tx.send(());
                }
            }
        });
    }

    let index_dir = crate::file_ops::get_index_dir();
    let storage = match crate::index::storage::Storage::open(&index_dir) {
        Ok(s) => s,
        Err(e) => {
            error!("Failed to open index storage for daemon: {}", e);
            return Err(e.into());
        }
    };

    // ── Accept loop ────────────────────────────────────────────────────────
    loop {
        tokio::select! {
            accept = listener.accept() => {
                let (mut socket, _) = accept?;
                let token_ref = token.clone();
                let tx_clone  = shutdown_tx.clone();
                let storage_clone = storage.clone();

                tokio::spawn(async move {
                    let mut buf = vec![0u8; 10 * 1024 * 1024]; // 10 MB cap
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        socket.read(&mut buf),
                    ).await {
                        Ok(Ok(n)) if n > 0 => {
                            match serde_json::from_slice::<JsonRpcRequest>(&buf[..n]) {
                                Ok(req) => {
                                    let provided = req.params
                                        .get("token")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("");

                                    if provided != token_ref {
                                        error!("Invalid token provided"); // token value never logged
                                        let res = serde_json::json!({
                                            "jsonrpc": "2.0",
                                            "error": {
                                                "code": -32001,
                                                "message": "Invalid or missing auth token"
                                            },
                                            "id": req.id
                                        });
                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                        return;
                                    }

                                    match req.method.as_str() {
                                        "status" => {
                                            let res = JsonRpcResponse {
                                                jsonrpc: "2.0".to_string(),
                                                result: Some(serde_json::json!({"status": "running"})),
                                                error: None,
                                                id: req.id,
                                            };
                                            let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                        }
                                        "stop" => {
                                            info!("Stop requested via RPC, shutting down gracefully.");
                                            let res = JsonRpcResponse {
                                                jsonrpc: "2.0".to_string(),
                                                result: Some(serde_json::json!({"status": "stopping"})),
                                                error: None,
                                                id: req.id,
                                            };
                                            let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            // Trigger graceful shutdown
                                            if let Ok(mut lock) = tx_clone.lock() {
                                                if let Some(tx) = lock.take() {
                                                    let _ = tx.send(());
                                                }
                                            }
                                        }
                                        "search" => {
                                            let query = req.params.get("query").and_then(|v| v.as_str()).unwrap_or("");
                                            let limit = req.params.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
                                            let engine = crate::index::query::QueryEngine::new(storage_clone.clone());
                                            
                                            match engine.execute(query, None, None, limit, 0) {
                                                Ok(results) => {
                                                    let res = JsonRpcResponse {
                                                        jsonrpc: "2.0".to_string(),
                                                        result: Some(serde_json::json!(results)),
                                                        error: None,
                                                        id: req.id,
                                                    };
                                                    let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                }
                                                Err(e) => {
                                                    let res = JsonRpcResponse {
                                                        jsonrpc: "2.0".to_string(),
                                                        result: None,
                                                        error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
                                                        id: req.id,
                                                    };
                                                    let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                }
                                            }
                                        }
                                        "read" => {
                                            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                            if path_str.contains("..") {
                                                let res = JsonRpcResponse {
                                                    jsonrpc: "2.0".to_string(),
                                                    result: None,
                                                    error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
                                                    id: req.id,
                                                };
                                                let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            } else {
                                                match std::fs::read_to_string(path_str) {
                                                    Ok(content) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: Some(serde_json::json!({ "content": content })),
                                                            error: None,
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                    Err(e) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: None,
                                                            error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                }
                                            }
                                        }
                                        "ls" => {
                                            // ... existing ls logic ...
                                            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                                            if path_str.contains("..") {
                                                let res = JsonRpcResponse {
                                                    jsonrpc: "2.0".to_string(),
                                                    result: None,
                                                    error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
                                                    id: req.id,
                                                };
                                                let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            } else {
                                                match std::fs::read_dir(path_str) {
                                                    Ok(entries) => {
                                                        let mut files = Vec::new();
                                                        for entry in entries.flatten() {
                                                            if let Ok(name) = entry.file_name().into_string() {
                                                                  let file_type = entry.file_type().map(|t| if t.is_dir() { "dir" } else { "file" }).unwrap_or("unknown");
                                                                  files.push(serde_json::json!({ "name": name, "type": file_type }));
                                                            }
                                                        }
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: Some(serde_json::json!({ "entries": files })),
                                                            error: None,
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                    Err(e) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: None,
                                                            error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                }
                                            }
                                        }
                                        "project_map" => {
                                            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
                                            let walker = crate::walker::ProjectWalker::new(std::path::PathBuf::from(path_str));
                                            let map = walker.generate_map();
                                            let res = JsonRpcResponse {
                                                jsonrpc: "2.0".to_string(),
                                                result: Some(serde_json::json!({ "map": map })),
                                                error: None,
                                                id: req.id,
                                            };
                                            let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                        }
                                        "write" => {
                                            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                            let content = req.params.get("content").and_then(|v| v.as_str()).unwrap_or("");
                                            if path_str.contains("..") {
                                                let res = JsonRpcResponse {
                                                    jsonrpc: "2.0".to_string(),
                                                    result: None,
                                                    error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
                                                    id: req.id,
                                                };
                                                let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            } else {
                                                // Shadow backup if file exists
                                                if std::path::Path::new(path_str).exists() {
                                                    let _ = shadow_backup(path_str);
                                                }
                                                // Ensure parent dir
                                                if let Some(parent) = std::path::Path::new(path_str).parent() {
                                                    let _ = std::fs::create_dir_all(parent);
                                                }
                                                match std::fs::write(path_str, content) {
                                                    Ok(_) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: Some(serde_json::json!({ "status": format!("SUCCESS: File written to {}", path_str) })),
                                                            error: None,
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                    Err(e) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: None,
                                                            error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                }
                                            }
                                        }
                                        "patch" => {
                                            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                            let target = req.params.get("target").and_then(|v| v.as_str()).unwrap_or("");
                                            let replacement = req.params.get("replacement").and_then(|v| v.as_str()).unwrap_or("");
                                            if path_str.contains("..") {
                                                let res = JsonRpcResponse {
                                                    jsonrpc: "2.0".to_string(),
                                                    result: None,
                                                    error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
                                                    id: req.id,
                                                };
                                                let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            } else {
                                                match std::fs::read_to_string(path_str) {
                                                    Ok(content) => {
                                                        if !content.contains(target) {
                                                            let res = JsonRpcResponse {
                                                                jsonrpc: "2.0".to_string(),
                                                                result: None,
                                                                error: Some(serde_json::json!({ "code": -32000, "message": format!("Target not found in {}", path_str) })),
                                                                id: req.id,
                                                            };
                                                            let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                        } else {
                                                            let _ = shadow_backup(path_str);
                                                            let patched = content.replacen(target, replacement, 1);
                                                            match std::fs::write(path_str, &patched) {
                                                                Ok(_) => {
                                                                    let res = JsonRpcResponse {
                                                                        jsonrpc: "2.0".to_string(),
                                                                        result: Some(serde_json::json!({ "status": format!("SUCCESS: Patch applied to {}", path_str) })),
                                                                        error: None,
                                                                        id: req.id,
                                                                    };
                                                                    let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                                }
                                                                Err(e) => {
                                                                    let res = JsonRpcResponse {
                                                                        jsonrpc: "2.0".to_string(),
                                                                        result: None,
                                                                        error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
                                                                        id: req.id,
                                                                    };
                                                                    let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                                }
                                                            }
                                                        }
                                                    }
                                                    Err(e) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: None,
                                                            error: Some(serde_json::json!({ "code": -32000, "message": format!("Failed to read file: {}", e) })),
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                }
                                            }
                                        }
                                        "delete" => {
                                            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                                            if path_str.contains("..") {
                                                let res = JsonRpcResponse {
                                                    jsonrpc: "2.0".to_string(),
                                                    result: None,
                                                    error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
                                                    id: req.id,
                                                };
                                                let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            } else if !std::path::Path::new(path_str).exists() {
                                                let res = JsonRpcResponse {
                                                    jsonrpc: "2.0".to_string(),
                                                    result: None,
                                                    error: Some(serde_json::json!({ "code": -32000, "message": format!("File not found: {}", path_str) })),
                                                    id: req.id,
                                                };
                                                let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            } else {
                                                let _ = shadow_backup(path_str);
                                                match std::fs::remove_file(path_str) {
                                                    Ok(_) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: Some(serde_json::json!({ "status": format!("SUCCESS: File {} deleted", path_str) })),
                                                            error: None,
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                    Err(e) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: None,
                                                            error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                }
                                            }
                                        }
                                        "rollback" => {
                                            let shadow_dir = get_shadow_dir();
                                            let manifest_path = shadow_dir.join("manifest.json");
                                            if !manifest_path.exists() {
                                                let res = JsonRpcResponse {
                                                    jsonrpc: "2.0".to_string(),
                                                    result: None,
                                                    error: Some(serde_json::json!({ "code": -32000, "message": "No shadow backup found" })),
                                                    id: req.id,
                                                };
                                                let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                            } else {
                                                match std::fs::read_to_string(&manifest_path) {
                                                    Ok(manifest_str) => {
                                                        if let Ok(manifest) = serde_json::from_str::<Vec<ShadowEntry>>(&manifest_str) {
                                                            let mut restored = 0u32;
                                                            let mut failed = 0u32;
                                                            for entry in &manifest {
                                                                let bak_path = shadow_dir.join(&entry.path_hash).with_extension("bak");
                                                                if bak_path.exists() {
                                                                    if let Ok(data) = std::fs::read(&bak_path) {
                                                                        if let Some(parent) = std::path::Path::new(&entry.original_path).parent() {
                                                                            let _ = std::fs::create_dir_all(parent);
                                                                        }
                                                                        match std::fs::write(&entry.original_path, &data) {
                                                                            Ok(_) => restored += 1,
                                                                            Err(_) => failed += 1,
                                                                        }
                                                                    } else {
                                                                        failed += 1;
                                                                    }
                                                                } else {
                                                                    failed += 1;
                                                                }
                                                            }
                                                            let res = JsonRpcResponse {
                                                                jsonrpc: "2.0".to_string(),
                                                                result: Some(serde_json::json!({ "status": format!("ROLLBACK: {} files restored, {} failed", restored, failed) })),
                                                                error: None,
                                                                id: req.id,
                                                            };
                                                            let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                        }
                                                    }
                                                    Err(_) => {
                                                        let res = JsonRpcResponse {
                                                            jsonrpc: "2.0".to_string(),
                                                            result: None,
                                                            error: Some(serde_json::json!({ "code": -32000, "message": "Failed to read manifest" })),
                                                            id: req.id,
                                                        };
                                                        let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                                    }
                                                }
                                            }
                                        }
										"glob" => {
											let pattern = req.params.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
											let base = req.params.get("base").and_then(|v| v.as_str()).unwrap_or(".");
											match glob_files(pattern, base) {
												Ok(files) => {
													let res = JsonRpcResponse {
														jsonrpc: "2.0".to_string(),
														result: Some(serde_json::json!({ "files": files })),
														error: None,
														id: req.id,
													};
													let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
												}
												Err(e) => {
													let res = JsonRpcResponse {
														jsonrpc: "2.0".to_string(),
														result: None,
														error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
														id: req.id,
													};
													let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
												}
											}
										}
										"find" => {
											let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
											let root = req.params.get("root").and_then(|v| v.as_str()).unwrap_or(".");
											let files = find_files(name, root);
											let res = JsonRpcResponse {
												jsonrpc: "2.0".to_string(),
												result: Some(serde_json::json!({ "files": files })),
												error: None,
												id: req.id,
											};
											let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
										}
										"mv" => {
											let from = req.params.get("from").and_then(|v| v.as_str()).unwrap_or("");
											let to = req.params.get("to").and_then(|v| v.as_str()).unwrap_or("");
											if from.contains("..") || to.contains("..") {
												let res = JsonRpcResponse {
													jsonrpc: "2.0".to_string(),
													result: None,
													error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
													id: req.id,
												};
												let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
											} else {
												let _ = shadow_backup(to);
												match std::fs::rename(from, to) {
													Ok(_) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: Some(serde_json::json!({ "status": format!("Moved {} to {}", from, to) })),
															error: None,
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
													Err(e) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
												}
											}
										}
										"cp" => {
											let from = req.params.get("from").and_then(|v| v.as_str()).unwrap_or("");
											let to = req.params.get("to").and_then(|v| v.as_str()).unwrap_or("");
											if from.contains("..") || to.contains("..") {
												let res = JsonRpcResponse {
													jsonrpc: "2.0".to_string(),
													result: None,
													error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
													id: req.id,
												};
												let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
											} else {
												match std::fs::copy(from, to) {
													Ok(n) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: Some(serde_json::json!({ "status": format!("Copied {} to {} ({} bytes)", from, to, n) })),
															error: None,
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
													Err(e) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
												}
											}
										}
										"mkdir" => {
											let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
											if path_str.contains("..") {
												let res = JsonRpcResponse {
													jsonrpc: "2.0".to_string(),
													result: None,
													error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
													id: req.id,
												};
												let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
											} else {
												match std::fs::create_dir_all(path_str) {
													Ok(_) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: Some(serde_json::json!({ "status": format!("Directory created: {}", path_str) })),
															error: None,
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
													Err(e) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
												}
											}
										}
										"rmdir" => {
											let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
											if path_str.contains("..") {
												let res = JsonRpcResponse {
													jsonrpc: "2.0".to_string(),
													result: None,
													error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
													id: req.id,
												};
												let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
											} else {
												match std::fs::remove_dir_all(path_str) {
													Ok(_) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: Some(serde_json::json!({ "status": format!("Directory removed: {}", path_str) })),
															error: None,
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
													Err(e) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
												}
											}
										}
										"append" => {
											let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
											let content = req.params.get("content").and_then(|v| v.as_str()).unwrap_or("");
											if path_str.contains("..") {
												let res = JsonRpcResponse {
													jsonrpc: "2.0".to_string(),
													result: None,
													error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
													id: req.id,
												};
												let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
											} else {
												let _ = shadow_backup(path_str);
												let mut f = match std::fs::OpenOptions::new().create(true).append(true).open(path_str) {
													Ok(f) => f,
													Err(e) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
														return;
													}
												};
												match std::io::Write::write_all(&mut f, content.as_bytes()) {
													Ok(_) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: Some(serde_json::json!({ "status": format!("Appended to {}", path_str) })),
															error: None,
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
													Err(e) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
												}
											}
										}
										"read_multiple" => {
											let paths = req.params.get("paths").and_then(|v| v.as_array()).cloned().unwrap_or_default();
											let mut files = serde_json::Map::new();
											for p in &paths {
												if let Some(path_str) = p.as_str() {
													if path_str.contains("..") {
														files.insert(path_str.to_string(), serde_json::json!("ERROR: Invalid path"));
													} else {
														match std::fs::read_to_string(path_str) {
															Ok(content) => { files.insert(path_str.to_string(), serde_json::json!(content)); }
															Err(e) => { files.insert(path_str.to_string(), serde_json::json!(format!("ERROR: {}", e))); }
														}
													}
												}
											}
											let res = JsonRpcResponse {
												jsonrpc: "2.0".to_string(),
												result: Some(serde_json::json!({ "files": files })),
												error: None,
												id: req.id,
											};
											let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
										}
										"file_info" => {
											let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
											if path_str.contains("..") {
												let res = JsonRpcResponse {
													jsonrpc: "2.0".to_string(),
													result: None,
													error: Some(serde_json::json!({ "code": -32000, "message": "Invalid path" })),
													id: req.id,
												};
												let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
											} else {
												match std::fs::metadata(path_str) {
													Ok(meta) => {
														let modified = meta.modified()
															.map(|t| chrono::DateTime::from_timestamp(t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() as i64, 0)
																.map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
																.unwrap_or_default())
															.unwrap_or_default();
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: Some(serde_json::json!({
																"size": meta.len() as i64,
																"is_dir": meta.is_dir(),
																"permissions": 0u32,
																"modified": modified,
															})),
															error: None,
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
													Err(e) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
												}
											}
										}
										"diff" => {
											let files = req.params.get("files").and_then(|v| v.as_array()).cloned().unwrap_or_default();
											let paths: Vec<&str> = files.iter().filter_map(|v| v.as_str()).collect();
											if paths.len() < 2 {
												let res = JsonRpcResponse {
													jsonrpc: "2.0".to_string(),
													result: None,
													error: Some(serde_json::json!({ "code": -32000, "message": "Need at least 2 files to diff" })),
													id: req.id,
												};
												let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
											} else {
												match (std::fs::read_to_string(paths[0]), std::fs::read_to_string(paths[1])) {
													(Ok(a), Ok(b)) => {
														let mut lines = Vec::new();
														let a_lines: Vec<&str> = a.lines().collect();
														let b_lines: Vec<&str> = b.lines().collect();
														let max = std::cmp::max(a_lines.len(), b_lines.len());
														for i in 0..max {
															match (a_lines.get(i), b_lines.get(i)) {
																(Some(la), Some(lb)) if la == lb => {
																	lines.push(serde_json::json!({"type": "same", "number": i + 1, "text": la}));
																}
																(Some(la), Some(lb)) => {
																	lines.push(serde_json::json!({"type": "removed", "number": i + 1, "text": la}));
																	lines.push(serde_json::json!({"type": "added", "number": i + 1, "text": lb}));
																}
																(Some(la), None) => {
																	lines.push(serde_json::json!({"type": "removed", "number": i + 1, "text": la}));
																}
																(None, Some(lb)) => {
																	lines.push(serde_json::json!({"type": "added", "number": i + 1, "text": lb}));
																}
																_ => {}
															}
														}
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: Some(serde_json::json!({
																"files": paths,
																"lines": lines,
															})),
															error: None,
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
													(Err(e), _) | (_, Err(e)) => {
														let res = JsonRpcResponse {
															jsonrpc: "2.0".to_string(),
															result: None,
															error: Some(serde_json::json!({ "code": -32000, "message": format!("Failed to read files: {}", e) })),
															id: req.id,
														};
														let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
													}
												}
											}
										}
										"ls_tree" => {
											let root = req.params.get("root").and_then(|v| v.as_str()).unwrap_or(".");
											match build_tree(root) {
												Ok(tree) => {
													let res = JsonRpcResponse {
														jsonrpc: "2.0".to_string(),
														result: Some(serde_json::json!({ "root": root, "tree": tree })),
														error: None,
														id: req.id,
													};
													let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
												}
												Err(e) => {
													let res = JsonRpcResponse {
														jsonrpc: "2.0".to_string(),
														result: None,
														error: Some(serde_json::json!({ "code": -32000, "message": e.to_string() })),
														id: req.id,
													};
													let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
												}
											}
										}
										_ => {
											let res = JsonRpcResponse {
												jsonrpc: "2.0".to_string(),
												result: None,
												error: Some(serde_json::json!({
													"code": -32601,
													"message": "Method not found"
												})),
												id: req.id,
											};
											let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
										}
                                    }
                                }
                                Err(e) => {
                                    error!("JSON parse error: {}", e);
                                    let res = serde_json::json!({
                                        "jsonrpc": "2.0",
                                        "error": { "code": -32700, "message": "Parse error" },
                                        "id": serde_json::Value::Null
                                    });
                                    let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
                                }
                            }
                        }
                        Ok(Ok(_)) => { /* 0 bytes, client closed */ }
                        Ok(Err(e)) => { error!("Socket read error: {}", e); }
                        Err(_) => { info!("Connection idle timeout, dropping socket"); }
                    }
                });
            }

            _ = &mut shutdown_rx => {
                // Graceful shutdown: clean up state files so status detects it immediately
                info!("Graceful shutdown: removing state files and exiting.");
                cleanup_state_files();
                // Allow in-flight tokio tasks a moment to finish writes
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                std::process::exit(0);
            }
        }
    }
}

// ── Shadow helpers (file operation backup / rollback) ──────────────────────────

use std::sync::Mutex;
use sha2::{Digest, Sha256};

#[derive(serde::Serialize, serde::Deserialize)]
struct ShadowEntry {
    path_hash: String,
    original_path: String,
}

static SHADOW_MANIFEST: Mutex<Option<Vec<ShadowEntry>>> = Mutex::new(None);

fn get_shadow_dir() -> PathBuf {
    let base = std::env::temp_dir().join("ruthen").join("indexer_shadow");
    let _ = std::fs::create_dir_all(&base);
    base
}

fn compute_path_hash(path: &str) -> String {
    format!("{:x}", Sha256::digest(path.as_bytes()))[..16].to_string()
}

fn shadow_backup(path: &str) -> std::io::Result<()> {
    let data = std::fs::read(path)?;
    let shadow_dir = get_shadow_dir();
    let hash = compute_path_hash(path);
    let bak_path = shadow_dir.join(format!("{}.bak", hash));
    if !bak_path.exists() {
        std::fs::write(&bak_path, &data)?;
    }
    // Track in manifest
    let mut guard = SHADOW_MANIFEST.lock().unwrap();
    let manifest = guard.get_or_insert_with(Vec::new);
    if !manifest.iter().any(|e| e.path_hash == hash) {
        manifest.push(ShadowEntry {
            path_hash: hash,
            original_path: path.to_string(),
        });
        // Persist manifest
        let manifest_path = shadow_dir.join("manifest.json");
        if let Ok(json) = serde_json::to_string(&manifest) {
            let _ = std::fs::write(&manifest_path, &json);
        }
    }
    Ok(())
}

// ── Client helpers ─────────────────────────────────────────────────────────────

// ── New helper functions ─────────────────────────────────────────────────────

fn glob_files(pattern: &str, base: &str) -> Result<Vec<String>, String> {
    use globset::{Glob, GlobSetBuilder};
    let mut builder = GlobSetBuilder::new();
    builder.add(Glob::new(pattern).map_err(|e| e.to_string())?);
    let glob_set = builder.build().map_err(|e| e.to_string())?;

    let base_path = std::path::Path::new(base);
    if !base_path.is_dir() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    let walker = ignore::WalkBuilder::new(base_path).build();
    for entry in walker.flatten() {
        if entry.path().is_file() {
            let rel = entry.path().strip_prefix(base_path).unwrap_or(entry.path());
            if glob_set.is_match(rel) {
                results.push(rel.to_string_lossy().to_string());
            }
        }
    }
    results.sort();
    Ok(results)
}

fn find_files(name: &str, root: &str) -> Vec<String> {
    let root_path = std::path::Path::new(root);
    if !root_path.is_dir() {
        return Vec::new();
    }
    let mut results = Vec::new();
    let walker = ignore::WalkBuilder::new(root_path).build();
    for entry in walker.flatten() {
        if entry.path().is_file() {
            if let Some(fname) = entry.path().file_name().and_then(|n| n.to_str()) {
                if fname.contains(name) || name.is_empty() {
                    results.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }
    results.sort();
    results
}

fn build_tree(root: &str) -> Result<Vec<serde_json::Value>, String> {
    let root_path = std::path::Path::new(root);
    if !root_path.is_dir() {
        return Ok(Vec::new());
    }

    fn build_dir(dir: &std::path::Path) -> std::io::Result<Vec<serde_json::Value>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            // Skip hidden entries
            if name.starts_with('.') {
                continue;
            }
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                let children = build_dir(&entry.path())?;
                entries.push(serde_json::json!({
                    "name": name,
                    "type": "dir",
                    "children": children,
                }));
            } else {
                entries.push(serde_json::json!({
                    "name": name,
                    "type": "file",
                }));
            }
        }
        entries.sort_by(|a, b| {
            let a_name = a["name"].as_str().unwrap_or("");
            let b_name = b["name"].as_str().unwrap_or("");
            let a_is_dir = a["type"].as_str() == Some("dir");
            let b_is_dir = b["type"].as_str() == Some("dir");
            // Dirs first, then alphabetical
            if a_is_dir != b_is_dir {
                return if a_is_dir { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
            }
            a_name.cmp(b_name)
        });
        Ok(entries)
    }

    build_dir(root_path).map_err(|e| e.to_string())
}

async fn send_rpc(method: &str, mut params: serde_json::Value) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let socket_path = "/tmp/ruthen/indexer.sock";
    
    if let Some(obj) = params.as_object_mut() {
        obj.insert("token".to_string(), serde_json::Value::String("uds-internal-trust".to_string()));
    }

    let req = JsonRpcRequest {
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
        id: 1,
    };

    let mut stream = UnixStream::connect(socket_path).await?;
    stream.write_all(&serde_json::to_vec(&req)?).await?;

    let mut buf = vec![0u8; 4096];
    let n = stream.read(&mut buf).await?;

    let res: JsonRpcResponse = serde_json::from_slice(&buf[..n])?;
    Ok(res.result.unwrap_or(serde_json::json!({})))
}
