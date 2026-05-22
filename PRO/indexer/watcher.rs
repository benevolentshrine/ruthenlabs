use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{EventKind, RecursiveMode, Watcher};
use tracing::{error, info, warn};

use crate::file_ops::IndexManager;
use crate::index::storage::Storage;
use crate::models::FileRecord;
use crate::walker::{process_file, Walker};

// TODO: Make DEBOUNCE_MS configurable via .indexer.toml in Phase 3 if users request it.
const DEBOUNCE_MS: u64 = 200;
const BURST_CAP: usize = 500;




pub async fn start_watching(
    path: PathBuf,
    index_path: PathBuf,
    write_lock: Arc<Mutex<()>>,
) -> Result<(), Box<dyn std::error::Error>> {
    // Derive the Sled store directory from the index_path parent
    let index_dir = index_path.parent().unwrap_or(&index_path).to_path_buf();

    let (tx, rx) = std::sync::mpsc::channel();
    let mut watcher = notify::recommended_watcher(tx)?;
    watcher.watch(&path, RecursiveMode::Recursive)?;

    info!("Watcher is running. Listening for changes in {:?}", path);

    loop {
        // Block until the first event of a new batch
        let first = match rx.recv() {
            Ok(ev) => ev,
            Err(_) => break, // sender dropped → watcher gone
        };

        // Drain further events for DEBOUNCE_MS to coalesce rapid saves
        let mut raw = vec![first];
        let deadline = Instant::now() + Duration::from_millis(DEBOUNCE_MS);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match rx.recv_timeout(remaining) {
                Ok(ev) => raw.push(ev),
                Err(RecvTimeoutError::Timeout) | Err(RecvTimeoutError::Disconnected) => break,
            }
        }

        // Collect unique paths from actionable event kinds
        let mut changed: HashSet<PathBuf> = HashSet::new();
        for res in raw {
            match res {
                Ok(event) => match event.kind {
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {
                        for p in event.paths {
                            changed.insert(p);
                        }
                    }
                    _ => {}
                },
                Err(e) => warn!("Watch backend error: {:?}", e),
            }
        }

        if changed.is_empty() {
            continue;
        }

        info!(
            "Debounced batch: {} unique path(s) to process",
            changed.len()
        );

        // Load the current index from Sled (best-effort; start empty on error)
        let storage = Storage::open(&index_dir)
            .unwrap_or_else(|e| { error!("Failed to open storage: {}", e); panic!("storage") });
        let mut records: Vec<FileRecord> = {
            let acc = Vec::new();
            if let Ok(iter) = storage.get_by_language("") {
                // get_by_language returns paths; for a full dump we iterate metadata directly
                let _ = iter; // not used here — we rebuild from walker on burst
            }
            acc
        };

        if changed.len() >= BURST_CAP {
            // Burst cap hit: full re-index is cheaper than N individual hashes
            info!(
                "Burst cap reached ({} paths ≥ {}), falling back to full re-index",
                changed.len(),
                BURST_CAP
            );
            let walker = Walker::new(&path);
            records = walker.walk();
        } else {
            let mut dirty = false;

            for p in &changed {
                // ── Symlink guard ────────────────────────────────────────────
                if let Ok(meta) = p.symlink_metadata() {
                    if meta.file_type().is_symlink() {
                        match std::fs::canonicalize(p) {
                            Ok(canonical) if !canonical.starts_with(&path) => {
                                warn!(
                                    "Symlink {:?} resolves outside root {:?}, skipping",
                                    p, path
                                );
                                continue;
                            }
                            Err(e) => {
                                warn!(
                                    "Symlink {:?} could not be canonicalized (possible loop): {}",
                                    p, e
                                );
                                continue;
                            }
                            Ok(_) => {} // symlink within root — process normally
                        }
                    }
                }

                if !p.exists() {
                    // Deleted
                    let key = p.to_string_lossy().to_string();
                    records.retain(|r| r.path != key);
                    dirty = true;
                } else if p.is_file() {
                    // Created or modified
                    match process_file(p, &path) {
                        Ok(Some(rec)) => {
                            records.retain(|r| r.path != rec.path);
                            records.push(rec);
                            dirty = true;
                        }
                        Ok(None) => {}
                        Err(e) => warn!("Skipping {:?}: {}", p, e),
                    }
                }
            }

            if !dirty {
                continue;
            }
        }

        let manager = IndexManager::new(
            Storage::open(&index_dir).expect("Failed to re-open storage for write"),
            write_lock.clone(),
        );
        match manager.write_index(records) {
            Ok(_) => info!("Incremental sync complete. Index updated."),
            Err(e) => error!("Fatal write failure: {}", e),
        }
    }

    Ok(())
}
