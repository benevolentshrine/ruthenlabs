#![allow(dead_code)]

use std::path::PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc::UnboundedSender;

/// Socket base directory: /tmp/ruthen (Unix) or %TEMP%/ruthen (Windows)
fn ruthen_base_dir() -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from("/tmp/ruthen")
    }
    #[cfg(not(unix))]
    {
        std::env::temp_dir().join("ruthen")
    }
}

/// Orchestrator socket path (Unix UDS) or port display (Windows)
pub fn orchestrator_socket_path() -> PathBuf {
    ruthen_base_dir().join("orchestrator.sock")
}

/// A message received from a sibling service via UDS.
#[derive(Debug, Clone)]
pub struct SiblingMessage {
    /// Which service sent the message: "sandbox", "indexer", or "unknown"
    pub source: String,
    /// The parsed JSON payload
    pub payload: serde_json::Value,
}

// ─── Unix: Native UDS via UnixListener ─────────────────────────────────────

#[cfg(unix)]
pub async fn run_uds_listener(tx: UnboundedSender<SiblingMessage>) {
    use tokio::net::UnixListener;

    let socket_path = orchestrator_socket_path();

    if let Some(parent) = socket_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            eprintln!("[orchestrator] Failed to create socket directory {:?}: {}", parent, e);
            return;
        }
    }

    if socket_path.exists() {
        let _ = tokio::fs::remove_file(&socket_path).await;
    }

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[orchestrator] Failed to bind UDS listener at {:?}: {}", socket_path, e);
            return;
        }
    };

    eprintln!("[orchestrator] UDS listener ready on {:?}", socket_path);

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let tx = tx.clone();
                tokio::spawn(handle_unix_connection(stream, tx));
            }
            Err(e) => {
                eprintln!("[orchestrator] Error accepting UDS connection: {}", e);
            }
        }
    }
}

#[cfg(unix)]
async fn handle_unix_connection(stream: tokio::net::UnixStream, tx: UnboundedSender<SiblingMessage>) {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(payload) => {
                        let source = payload
                            .get("source")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let msg = SiblingMessage { source, payload };
                        let _ = tx.send(msg);
                    }
                    Err(e) => {
                        eprintln!("[orchestrator] Failed to parse NDJSON line: {}  line={:?}", e, trimmed);
                    }
                }
            }
            Err(e) => {
                eprintln!("[orchestrator] Error reading from UDS stream: {}", e);
                break;
            }
        }
    }
}

// ─── Non-Unix fallback: TCP on localhost ────────────────────────────────────

#[cfg(not(unix))]
pub async fn run_uds_listener(tx: UnboundedSender<SiblingMessage>) {
    use tokio::net::TcpListener;

    let addr = "127.0.0.1:0";
    let listener = match TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[orchestrator] Failed to bind TCP listener on {}: {}", addr, e);
            return;
        }
    };

    let local_addr = listener.local_addr().unwrap();
    eprintln!("[orchestrator] TCP listener ready on {} (Unix sockets not available on this platform)", local_addr);

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let tx = tx.clone();
                tokio::spawn(handle_tcp_connection(stream, tx));
            }
            Err(e) => {
                eprintln!("[orchestrator] Error accepting TCP connection: {}", e);
            }
        }
    }
}

#[cfg(not(unix))]
async fn handle_tcp_connection(stream: tokio::net::TcpStream, tx: UnboundedSender<SiblingMessage>) {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(payload) => {
                        let source = payload
                            .get("source")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                            .to_string();
                        let msg = SiblingMessage { source, payload };
                        let _ = tx.send(msg);
                    }
                    Err(e) => {
                        eprintln!("[orchestrator] Failed to parse NDJSON line: {}  line={:?}", e, trimmed);
                    }
                }
            }
            Err(e) => {
                eprintln!("[orchestrator] Error reading from TCP stream: {}", e);
                break;
            }
        }
    }
}
