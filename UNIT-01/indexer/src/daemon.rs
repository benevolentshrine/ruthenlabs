use crate::index::embed::Embedder;
use crate::DaemonAction;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tracing::{error, info};

static DEP_GRAPH: once_cell::sync::Lazy<Mutex<crate::index::depgraph::DepGraph>> =
    once_cell::sync::Lazy::new(|| Mutex::new(crate::index::depgraph::DepGraph::new()));

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

// ── Paths ───────────────────────────────────────────────────────────────

fn get_indexer_dir() -> PathBuf {
    if let Ok(env_dir) = std::env::var("INDEXER_DATA_DIR") {
        let dir = PathBuf::from(env_dir);
        std::fs::create_dir_all(&dir).ok();
        return dir;
    }
    if let Some(proj_dirs) = directories::ProjectDirs::from("com", "ruthenlabs", "indexer") {
        let dir = proj_dirs.data_dir().to_path_buf();
        std::fs::create_dir_all(&dir).ok();
        dir
    } else {
        PathBuf::from(".")
    }
}

fn get_pid_file() -> PathBuf {
    get_indexer_dir().join("daemon.pid")
}

fn write_pid_file() -> std::io::Result<()> {
    let mut f = File::create(get_pid_file())?;
    write!(f, "{}", std::process::id())?;
    Ok(())
}

fn read_pid_file() -> Option<u32> {
    let mut f = File::open(get_pid_file()).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    s.trim().parse().ok()
}

fn cleanup_state_files() {
    let _ = std::fs::remove_file(get_pid_file());
}

#[cfg(unix)]
fn pid_is_alive(pid: u32) -> bool {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;
    kill(Pid::from_raw(pid as i32), None).is_ok()
}

#[cfg(not(unix))]
fn pid_is_alive(pid: u32) -> bool {
    use std::process::Command;
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

// ── Path safety ─────────────────────────────────────────────────────────

fn safe_path(path_str: &str, working_dir: &Path) -> Result<PathBuf, String> {
    let path = Path::new(path_str);
    let path = if path.is_relative() {
        working_dir.join(path)
    } else {
        path.to_path_buf()
    };
    let canonical = path
        .canonicalize()
        .map_err(|_| format!("Path does not exist or is inaccessible: {}", path_str))?;
    let wd_canonical = working_dir
        .canonicalize()
        .map_err(|_| "Working directory inaccessible".to_string())?;
    if canonical.starts_with(&wd_canonical) {
        Ok(canonical)
    } else {
        Err(format!("Path escapes working directory: {}", path_str))
    }
}

fn working_dir() -> PathBuf {
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

// ── CLI action entry-point ──────────────────────────────────────────────

pub async fn handle_daemon_action(
    action: &DaemonAction,
) -> Result<(), Box<dyn std::error::Error>> {
    match action {
        DaemonAction::Start => {
            if std::env::var("INDEXER_DAEMON_INTERNAL").is_ok() {
                run_daemon_server().await?;
                return Ok(());
            }

            if let Some(pid) = read_pid_file() {
                if pid_is_alive(pid) {
                    info!("Daemon already running (PID {})", pid);
                    return Ok(());
                }
                info!("Stale PID file, cleaning up");
                cleanup_state_files();
            }

            let exe = std::env::current_exe()?;
            let log_path = get_indexer_dir().join("daemon.log");
            let log_file = File::create(&log_path)?;

            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                let _ = std::process::Command::new(&exe)
                    .args(["daemon", "start"])
                    .env("INDEXER_DAEMON_INTERNAL", "1")
                    .stdin(std::process::Stdio::null())
                    .stdout(log_file.try_clone()?)
                    .stderr(log_file)
                    .process_group(0)
                    .spawn()?;
            }
            #[cfg(not(unix))]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                let _ = std::process::Command::new(&exe)
                    .args(["daemon", "start"])
                    .env("INDEXER_DAEMON_INTERNAL", "1")
                    .stdin(std::process::Stdio::null())
                    .stdout(log_file.try_clone()?)
                    .stderr(log_file)
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()?;
            }

            info!("Daemon launched. Logs -> {:?}", log_path);
        }

        DaemonAction::Status => {
            match read_pid_file() {
                None => info!("Daemon not running"),
                Some(pid) if !pid_is_alive(pid) => {
                    info!("Daemon not running (PID {} dead)", pid);
                    cleanup_state_files();
                }
                Some(pid) => {
                    info!("PID {} alive; querying...", pid);
                    match send_rpc("status", serde_json::json!({})).await {
                        Ok(res) => info!("Status: {:?}", res),
                        Err(e) => info!("Unreachable: {}", e),
                    }
                }
            }
        }

        DaemonAction::Stop => {
            let res = send_rpc("stop", serde_json::json!({})).await?;
            info!("Stop response: {:?}", res);
        }
    }
    Ok(())
}

// ── Server loop ─────────────────────────────────────────────────────────

async fn run_daemon_server() -> Result<(), Box<dyn std::error::Error>> {
    let socket_path = "/tmp/ruthen/indexer.sock";

    if let Some(parent) = Path::new(socket_path).parent() {
        std::fs::create_dir_all(parent)?;
    }
    let _ = std::fs::remove_file(socket_path);

    let listener = UnixListener::bind(socket_path)?;
    info!(
        "Daemon listening on UDS: {} (PID {})",
        socket_path,
        std::process::id()
    );

    write_pid_file()?;

    // Graceful shutdown via signal
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let shutdown_tx = std::sync::Arc::new(std::sync::Mutex::new(Some(shutdown_tx)));

    #[cfg(unix)]
    {
        let tx = shutdown_tx.clone();
        tokio::spawn(async move {
            use tokio::signal::unix::{signal, SignalKind};
            let mut sigterm = signal(SignalKind::terminate()).unwrap();
            let mut sigint = signal(SignalKind::interrupt()).unwrap();
            tokio::select! {
                _ = sigterm.recv() => info!("SIGTERM"),
                _ = sigint.recv()  => info!("SIGINT"),
            }
            if let Ok(mut lock) = tx.lock() {
                if let Some(tx) = lock.take() {
                    let _ = tx.send(());
                }
            }
        });
    }
    #[cfg(not(unix))]
    {
        let tx = shutdown_tx.clone();
        tokio::spawn(async move {
            let _ = tokio::signal::ctrl_c().await;
            info!("Ctrl-C");
            if let Ok(mut lock) = tx.lock() {
                if let Some(tx) = lock.take() {
                    let _ = tx.send(());
                }
            }
        });
    }

    // Open search index at startup
    let index_dir = crate::index::storage::index_dir();

    // Try to load ONNX embedder, fall back to hash embedder
    let embedder: Arc<dyn crate::index::embed::Embedder + Send + Sync> =
        if crate::index::embed_onnx::OrtEmbedder::is_model_available() {
            let model_dir = crate::index::embed_onnx::OrtEmbedder::model_dir();
            match crate::index::embed_onnx::OrtEmbedder::new(
                &model_dir.join("model.onnx"),
                &model_dir.join("tokenizer.json"),
            ) {
                Ok(e) => {
                    info!("Loaded ONNX embedding model (dim={})", e.dimension());
                    Arc::new(e)
                }
                Err(e) => {
                    info!("ONNX model load failed ({}), using hash embedder", e);
                    Arc::new(crate::index::embed::HashEmbedder::new())
                }
            }
        } else {
            info!("No ONNX model found, using hash embedder");
            Arc::new(crate::index::embed::HashEmbedder::new())
        };

    // Try to load cross-encoder reranker
    let reranker = {
        let model_dir = crate::index::embed_onnx::OrtEmbedder::model_dir();
        let reranker_path = model_dir.join("reranker.onnx");
        let tok_path = model_dir.join("reranker_tokenizer.json");
        if reranker_path.exists() && tok_path.exists() {
            match crate::index::reranker::CrossEncoder::new(&reranker_path, &tok_path) {
                Ok(r) => {
                    info!("Loaded cross-encoder reranker");
                    Some(r)
                }
                Err(e) => {
                    info!("Reranker load failed ({}), skipping", e);
                    None
                }
            }
        } else {
            info!("No reranker model found, skipping");
            None
        }
    };

    let mut si = crate::index::search::SearchIndex::open(&index_dir)
        .map_err(|e| format!("Open search index: {}", e))?;
    si.set_embedder(embedder.clone());
    if let Some(r) = reranker {
        si.set_reranker(r);
    }
    let tantivy = std::sync::Arc::new(tokio::sync::Mutex::new(si));

    // Accept loop
    loop {
        tokio::select! {
            accept = listener.accept() => {
                let (mut socket, _) = accept?;
                let tantivy = tantivy.clone();
                let embedder = embedder.clone();
                let tx = shutdown_tx.clone();

                tokio::spawn(async move {
                    let mut buf = vec![0u8; 2 * 1024 * 1024];
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(60),
                        socket.read(&mut buf),
                    ).await {
                        Ok(Ok(n)) if n > 0 => {
                            match serde_json::from_slice::<JsonRpcRequest>(&buf[..n]) {
                                Ok(req) => {
                                    handle_request(req, &mut socket, tantivy, embedder, tx).await;
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
                        Ok(Ok(_)) => {}
                        Ok(Err(e)) => error!("Socket read error: {}", e),
                        Err(_) => info!("Connection timeout"),
                    }
                });
            }

            _ = &mut shutdown_rx => {
                info!("Shutting down");
                cleanup_state_files();
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                std::process::exit(0);
            }
        }
    }
}

static WATCHED_PATHS: once_cell::sync::Lazy<Mutex<HashSet<PathBuf>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashSet::new()));

fn start_background_watcher(
    path: PathBuf,
    tantivy: std::sync::Arc<tokio::sync::Mutex<crate::index::search::SearchIndex>>,
    embedder: Arc<dyn Embedder + Send + Sync>,
) {
    let mut watched = WATCHED_PATHS.lock().unwrap();
    if watched.contains(&path) {
        return;
    }
    watched.insert(path.clone());
    drop(watched);

    info!("Spawning background watcher for {:?}", path);
    tokio::spawn(async move {
        let mut watch_rx = crate::index::watcher::start_watch(&path, 500);
        let index_dir = crate::index::storage::index_dir();
        let vector_db_path = index_dir.join("vectors.db");
        let hash_db_path = index_dir.join("hashes.sled");

        let hash_store = match crate::index::incremental::ContentHashStore::open(&hash_db_path) {
            Ok(hs) => hs,
            Err(e) => {
                error!("Watcher: Failed to open hash store: {}", e);
                return;
            }
        };

        while let Some(event) = watch_rx.recv().await {
            match event {
                crate::index::watcher::WatchEvent::Modified(paths) => {
                    info!("[Watcher] Detected {} file changes, updating index...", paths.len());
                    for p in &paths {
                        let p_path = std::path::Path::new(p);
                        if !p_path.is_file() {
                            continue;
                        }
                        let content = match std::fs::read_to_string(p) {
                            Ok(c) => c,
                            Err(_) => continue,
                        };

                        // Check if content hash changed
                        let changed = match hash_store.has_changed(p, content.as_bytes()) {
                            Ok(c) => c,
                            Err(_) => true,
                        };
                        if !changed {
                            continue;
                        }

                        let relative = p_path
                            .strip_prefix(&path)
                            .unwrap_or(p_path)
                            .to_string_lossy()
                            .to_string();
                        let ext = p_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                        let language = crate::index::chunker::language_from_ext(ext);
                        
                        let chunks = crate::index::chunker::chunk_file(
                            &content,
                            p,
                            &relative,
                            language,
                        );

                        // Update vector DB
                        if let Ok(vs) = crate::index::vector::VectorStore::open(&vector_db_path) {
                            let _ = vs.remove_file(p);
                            let _ = vs.insert_chunks(&chunks, embedder.as_ref());
                        }

                        // Update Tantivy search index
                        let mut guard = tantivy.lock().await;
                        let _ = guard.index_chunks(&chunks);
                        drop(guard);

                        // Update dependency graph
                        let mut graph = DEP_GRAPH.lock().unwrap();
                        graph.add_file(p, &relative, language);
                        let _ = graph.add_dependencies(p, &content, language);
                        drop(graph);

                        let _ = hash_store.update_hash(p, content.as_bytes());
                        info!("[Watcher] Reindexed: {}", relative);
                    }
                    let _ = hash_store.flush();
                }
                crate::index::watcher::WatchEvent::Error(e) => {
                    error!("[Watcher] File watch error: {}", e);
                }
            }
        }
        
        // Remove from watched set on watch end
        let mut watched = WATCHED_PATHS.lock().unwrap();
        watched.remove(&path);
    });
}

async fn handle_request(
    req: JsonRpcRequest,
    socket: &mut UnixStream,
    tantivy: std::sync::Arc<tokio::sync::Mutex<crate::index::search::SearchIndex>>,
    embedder: Arc<dyn Embedder + Send + Sync>,
    shutdown_tx: std::sync::Arc<std::sync::Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
) {
    match req.method.as_str() {
        "status" => {
            ok(socket, req.id, serde_json::json!({"status": "running"})).await;
        }
        "stop" => {
            info!("Stop requested");
            ok(socket, req.id, serde_json::json!({"status": "stopping"})).await;
            if let Ok(mut lock) = shutdown_tx.lock() {
                if let Some(tx) = lock.take() {
                    let _ = tx.send(());
                }
            }
        }
        "search" => {
            let pattern = req.params.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = req.params.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            let lang = req.params.get("lang").and_then(|v| v.as_str());
            let path_filter = req.params.get("path").and_then(|v| v.as_str());

            let guard = tantivy.lock().await;
            match guard.search(pattern, lang, path_filter, limit) {
                Ok(results) => {
                    ok(socket, req.id, serde_json::json!({
                        "results": results,
                        "count": results.len(),
                    })).await;
                }
                Err(e) => {
                    err(socket, req.id, -32000, &e.to_string()).await;
                }
            }
        }
        "semantic_search" => {
            let query = req.params.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let limit = req.params.get("limit").and_then(|v| v.as_u64()).unwrap_or(10) as usize;

            let guard = tantivy.lock().await;
            match guard.semantic_search(query, limit) {
                Ok(results) => {
                    ok(socket, req.id, serde_json::json!({
                        "results": results,
                        "count": results.len(),
                    })).await;
                }
                Err(e) => {
                    err(socket, req.id, -32000, &e.to_string()).await;
                }
            }
        }
        "glob" => {
            let pattern = req.params.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            let base = req.params.get("base").and_then(|v| v.as_str()).unwrap_or(".");
            match crate::walker::glob_files(pattern, base) {
                Ok(files) => ok(socket, req.id, serde_json::json!({"files": files})).await,
                Err(e) => err(socket, req.id, -32000, &e).await,
            }
        }
        "find" => {
            let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let root = req.params.get("root").and_then(|v| v.as_str()).unwrap_or(".");
            let files = crate::walker::find_files(name, root);
            ok(socket, req.id, serde_json::json!({"files": files})).await;
        }
        "file_info" => {
            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match safe_path(path_str, &working_dir()) {
                Ok(canonical) => match std::fs::metadata(&canonical) {
                    Ok(meta) => {
                        let modified = meta
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        ok(socket, req.id, serde_json::json!({
                            "size": meta.len(),
                            "is_dir": meta.is_dir(),
                            "modified": modified,
                        }))
                        .await;
                    }
                    Err(e) => err(socket, req.id, -32000, &e.to_string()).await,
                },
                Err(e) => err(socket, req.id, -32002, &e).await,
            }
        }
        "read" => {
            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            match safe_path(path_str, &working_dir()) {
                Ok(canonical) => match std::fs::read_to_string(&canonical) {
                    Ok(content) => {
                        ok(socket, req.id, serde_json::json!({"content": content}))
                            .await
                    }
                    Err(e) => err(socket, req.id, -32000, &e.to_string()).await,
                },
                Err(e) => err(socket, req.id, -32002, &e).await,
            }
        }
        "write" => {
            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let content = req.params.get("content").and_then(|v| v.as_str()).unwrap_or("");

            let wd = working_dir();
            let path = Path::new(path_str);
            let target = if path.is_relative() {
                wd.join(path)
            } else {
                path.to_path_buf()
            };

            // Shadow backup
            if target.exists() && target.is_file() {
                let _ = shadow_backup(path_str, &target);
            }
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::write(&target, content) {
                Ok(_) => ok(socket, req.id, serde_json::json!({"status": "written"})).await,
                Err(e) => err(socket, req.id, -32000, &e.to_string()).await,
            }
        }
        "patch" => {
            let path_str = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let target_str = req.params.get("target").and_then(|v| v.as_str()).unwrap_or("");
            let replacement = req.params.get("replacement").and_then(|v| v.as_str()).unwrap_or("");

            let wd = working_dir();
            let path = Path::new(path_str);
            let target_path = if path.is_relative() {
                wd.join(path)
            } else {
                path.to_path_buf()
            };

            match std::fs::read_to_string(&target_path) {
                Ok(content) => {
                    if !content.contains(target_str) {
                        err(socket, req.id, -32000, "Target not found").await;
                        return;
                    }
                    let _ = shadow_backup(path_str, &target_path);
                    let patched = content.replacen(target_str, replacement, 1);
                    match std::fs::write(&target_path, &patched) {
                        Ok(_) => ok(socket, req.id, serde_json::json!({"status": "patched"})).await,
                        Err(e) => err(socket, req.id, -32000, &e.to_string()).await,
                    }
                }
                Err(e) => err(socket, req.id, -32000, &e.to_string()).await,
            }
        }
        "diff" => {
            let files = req.params.get("files").and_then(|v| v.as_array()).cloned().unwrap_or_default();
            let paths: Vec<&str> = files.iter().filter_map(|v| v.as_str()).collect();
            if paths.len() < 2 {
                err(socket, req.id, -32000, "Need 2 files to diff").await;
                return;
            }
            let wd = working_dir();
            let a_path = if Path::new(paths[0]).is_relative() { wd.join(paths[0]) } else { PathBuf::from(paths[0]) };
            let b_path = if Path::new(paths[1]).is_relative() { wd.join(paths[1]) } else { PathBuf::from(paths[1]) };

            match (std::fs::read_to_string(&a_path), std::fs::read_to_string(&b_path)) {
                (Ok(a), Ok(b)) => {
                    let a_lines: Vec<&str> = a.lines().collect();
                    let b_lines: Vec<&str> = b.lines().collect();
                    let max = std::cmp::max(a_lines.len(), b_lines.len());
                    let mut lines = Vec::new();
                    for i in 0..max {
                        match (a_lines.get(i), b_lines.get(i)) {
                            (Some(la), Some(lb)) if la == lb => {
                                lines.push(serde_json::json!({"type": "same", "line": i + 1, "text": la}));
                            }
                            (Some(la), Some(lb)) => {
                                lines.push(serde_json::json!({"type": "removed", "line": i + 1, "text": la}));
                                lines.push(serde_json::json!({"type": "added", "line": i + 1, "text": lb}));
                            }
                            (Some(la), None) => {
                                lines.push(serde_json::json!({"type": "removed", "line": i + 1, "text": la}));
                            }
                            (None, Some(lb)) => {
                                lines.push(serde_json::json!({"type": "added", "line": i + 1, "text": lb}));
                            }
                            _ => {}
                        }
                    }
                    ok(socket, req.id, serde_json::json!({"files": paths, "lines": lines})).await;
                }
                (Err(e), _) | (_, Err(e)) => err(socket, req.id, -32000, &format!("Read error: {}", e)).await,
            }
        }
        "dependents" => {
            let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let deps = DEP_GRAPH.lock().unwrap().dependents_of(path);
            ok(socket, req.id, serde_json::json!({"dependents": deps})).await;
        }
        "dependencies" => {
            let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let deps = DEP_GRAPH.lock().unwrap().dependencies_of(path);
            ok(socket, req.id, serde_json::json!({"dependencies": deps})).await;
        }
        "transitive_dependents" => {
            let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let deps = DEP_GRAPH.lock().unwrap().transitive_dependents(path);
            ok(socket, req.id, serde_json::json!({"transitive_dependents": deps})).await;
        }
        "find_export" => {
            let symbol = req.params.get("symbol").and_then(|v| v.as_str()).unwrap_or("");
            let files = DEP_GRAPH.lock().unwrap().find_file_by_export(symbol);
            ok(socket, req.id, serde_json::json!({"files": files})).await;
        }
        "impact" => {
            let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let report = DEP_GRAPH.lock().unwrap().impact_analysis(path);
            ok(socket, req.id, serde_json::json!({"impact": report})).await;
        }
        "index_deps" => {
            let path = req.params.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let root = std::path::Path::new(path);
            
            let canonical_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
            start_background_watcher(canonical_root.clone(), tantivy.clone(), embedder.clone());

            let walker = crate::walker::Walker::new(root);
            let records = walker.walk();
            let node_count = {
                let mut graph = DEP_GRAPH.lock().unwrap();
                for r in &records {
                    graph.add_file(&r.path, &r.relative_path, &r.language);
                    if !r.is_binary {
                        if let Ok(content) = std::fs::read_to_string(&r.path) {
                            graph.add_dependencies(&r.path, &content, &r.language);
                        }
                    }
                }
                graph.all_nodes().len()
            };
            ok(socket, req.id, serde_json::json!({
                "indexed": records.len(),
                "nodes": node_count,
            })).await;
        }
        "shadow_list" => {
            let entries = list_shadow_backups().unwrap_or_default();
            ok(socket, req.id, serde_json::json!({
                "entries": entries,
                "count": entries.len(),
            })).await;
        }
        "rollback" => {
            let shadow_dir = shadow_dir();
            let manifest_path = shadow_dir.join("manifest.json");
            if !manifest_path.exists() {
                err(socket, req.id, -32000, "No shadow backup found").await;
                return;
            }
            match std::fs::read_to_string(&manifest_path) {
                Ok(manifest_str) => {
                    if let Ok(manifest) = serde_json::from_str::<Vec<ShadowEntry>>(&manifest_str) {
                        let mut restored = 0u32;
                        let mut failed = 0u32;
                        for entry in &manifest {
                            let bak_path = shadow_dir.join(&entry.path_hash).with_extension("bak");
                            if bak_path.exists() {
                                if let Ok(data) = std::fs::read(&bak_path) {
                                    if let Some(parent) = Path::new(&entry.original_path).parent() {
                                        let _ = std::fs::create_dir_all(parent);
                                    }
                                    match std::fs::write(&entry.original_path, &data) {
                                        Ok(_) => restored += 1,
                                        Err(_) => failed += 1,
                                    }
                                }
                            }
                        }
                        ok(socket, req.id, serde_json::json!({
                            "status": format!("{} restored, {} failed", restored, failed),
                        }))
                        .await;
                    }
                }
                Err(_) => err(socket, req.id, -32000, "Failed to read manifest").await,
            }
        }
        _ => {
            err(socket, req.id, -32601, "Method not found").await;
        }
    }
}

// ── Response helpers ────────────────────────────────────────────────────

async fn ok(socket: &mut UnixStream, id: u64, result: serde_json::Value) {
    let res = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: Some(result),
        error: None,
        id,
    };
    let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
}

async fn err(socket: &mut UnixStream, id: u64, code: i64, message: &str) {
    let res = JsonRpcResponse {
        jsonrpc: "2.0".to_string(),
        result: None,
        error: Some(serde_json::json!({ "code": code, "message": message })),
        id,
    };
    let _ = socket.write_all(&serde_json::to_vec(&res).unwrap()).await;
}

// ── Shadow backup (for write/patch rollback) ────────────────────────────

#[derive(Serialize, Deserialize, Debug)]
pub struct ShadowEntry {
    pub path_hash: String,
    pub original_path: String,
}

static SHADOW_MANIFEST: Mutex<Option<Vec<ShadowEntry>>> = Mutex::new(None);

pub fn shadow_dir() -> PathBuf {
    let base = std::env::temp_dir().join("ruthen").join("indexer_shadow");
    let _ = std::fs::create_dir_all(&base);
    base
}

fn compute_path_hash(path: &str) -> String {
    format!("{:x}", Sha256::digest(path.as_bytes()))[..16].to_string()
}

fn shadow_backup(path_str: &str, actual_path: &Path) -> std::io::Result<()> {
    let data = std::fs::read(actual_path)?;
    let dir = shadow_dir();
    let hash = compute_path_hash(path_str);
    let bak_path = dir.join(format!("{}.bak", hash));
    if !bak_path.exists() {
        std::fs::write(&bak_path, &data)?;
    }
    let mut guard = SHADOW_MANIFEST.lock().unwrap();
    let manifest = guard.get_or_insert_with(Vec::new);
    if !manifest.iter().any(|e| e.path_hash == hash) {
        manifest.push(ShadowEntry {
            path_hash: hash,
            original_path: path_str.to_string(),
        });
        let manifest_path = dir.join("manifest.json");
        if let Ok(json) = serde_json::to_string(&manifest) {
            let _ = std::fs::write(&manifest_path, &json);
        }
    }
    Ok(())
}

// ── Shadow status (for CLI) ─────────────────────────────────────────────

pub fn list_shadow_backups() -> Result<Vec<ShadowEntry>, String> {
    let manifest_path = shadow_dir().join("manifest.json");
    if !manifest_path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;
    serde_json::from_str::<Vec<ShadowEntry>>(&data)
        .map_err(|e| format!("Failed to parse manifest: {}", e))
}

// ── Client RPC helper ───────────────────────────────────────────────────

pub async fn send_rpc(
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, Box<dyn std::error::Error>> {
    let socket_path = "/tmp/ruthen/indexer.sock";

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
