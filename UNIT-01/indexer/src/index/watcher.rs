use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebounceEventResult};
use tokio::sync::mpsc as tokio_mpsc;
use tracing::{error, info};

pub enum WatchEvent {
    Modified(Vec<String>),
    Error(String),
}

fn is_ignored_path(path: &Path) -> bool {
    for component in path.components() {
        if let Some(name) = component.as_os_str().to_str() {
            if name == "target"
                || name == "node_modules"
                || name == "dist"
                || name == ".git"
                || name == ".ruthen"
                || name == "indexer_index"
                || name == ".githooks"
                || name == ".github"
            {
                return true;
            }
        }
    }
    false
}

pub fn start_watch(
    root: &Path,
    debounce_ms: u64,
) -> tokio_mpsc::Receiver<WatchEvent> {
    let (tx, rx) = tokio_mpsc::channel(256);
    let root = root.to_path_buf();

    std::thread::spawn(move || {
        let (notify_tx, notify_rx) = mpsc::channel();

        let mut debouncer = match new_debouncer(
            Duration::from_millis(debounce_ms),
            move |res: DebounceEventResult| {
                let _ = notify_tx.send(res);
            },
        ) {
            Ok(d) => d,
            Err(e) => {
                error!("Failed to create debouncer: {}", e);
                return;
            }
        };

        match debouncer.watcher().watch(&root, RecursiveMode::Recursive) {
            Ok(_) => info!("Watching {:?} for changes", root),
            Err(e) => {
                error!("Failed to start watcher: {}", e);
                return;
            }
        };

        for result in notify_rx {
            match result {
                Ok(events) => {
                    let mut paths: Vec<String> = Vec::new();
                    for event in &events {
                        if is_ignored_path(&event.path) {
                            continue;
                        }
                        let path_str = event.path.to_string_lossy().to_string();
                        if path_str.contains("/.")
                            || path_str.contains("\\.")
                            || path_str.ends_with('~')
                        {
                            continue;
                        }
                        if event
                            .path
                            .extension()
                            .and_then(|e| e.to_str())
                            == Some("swp")
                        {
                            continue;
                        }
                        paths.push(path_str);
                    }
                    paths.sort();
                    paths.dedup();
                    if !paths.is_empty() {
                        let _ = tx.blocking_send(WatchEvent::Modified(paths));
                    }
                }
                Err(e) => {
                    error!("Watch error: {}", e);
                    let _ = tx.blocking_send(WatchEvent::Error(e.to_string()));
                }
            }
        }
    });

    rx
}
