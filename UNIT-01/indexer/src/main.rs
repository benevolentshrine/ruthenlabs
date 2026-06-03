mod daemon;
mod index;
mod models;
mod walker;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{error, info};
use tracing_subscriber::FmtSubscriber;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
pub enum DaemonAction {
    Start,
    Stop,
    Status,
}

#[derive(Subcommand)]
enum Commands {
    /// Index a directory for fast search
    Index {
        #[arg(short, long, default_value = ".")]
        path: PathBuf,
        #[arg(long)]
        watch: bool,
    },
    /// List indexed files
    List,
    /// Watch a directory for changes and auto-reindex
    Watch {
        #[arg(short, long, default_value = ".")]
        path: PathBuf,
    },
    /// Manage the indexer background daemon
    Daemon {
        #[command(subcommand)]
        action: DaemonAction,
    },
    /// Search indexed files for a pattern
    Query {
        pattern: String,
        #[arg(short, long)]
        lang: Option<String>,
        #[arg(short, long)]
        path: Option<String>,
        #[arg(long, default_value = "20")]
        limit: usize,
    },
    /// Search with semantic intent (natural language)
    Semantic {
        query: String,
        #[arg(long, default_value = "10")]
        limit: usize,
    },
    /// Find files by name
    Find {
        name: String,
        #[arg(short, long, default_value = ".")]
        root: PathBuf,
    },
    /// Glob files by pattern
    Glob {
        pattern: String,
        #[arg(short, long, default_value = ".")]
        base: PathBuf,
    },
    /// Rollback shadow backups — restore files to pre-write state
    Undo,
    /// Show shadow backup status — files available for rollback
    Shadow,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let subscriber = FmtSubscriber::builder()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "indexer=info".to_string()),
        )
        .finish();
    tracing::subscriber::set_global_default(subscriber)
        .expect("setting default subscriber failed");

    let cli = Cli::parse();

    match &cli.command {
        Commands::Index { path, watch } => {
            info!("Indexing {:?} (watch: {})", path, watch);
            let index_dir = index::storage::index_dir();

            let mut tantivy_index = index::search::SearchIndex::open(&index_dir)?;

            let embedder = Arc::new(index::embed::HashEmbedder::new());
            tantivy_index.set_embedder(embedder.clone());

            let records = walker::Walker::new(path).walk();
            index::storage::save_metadata(&index_dir, &records)?;

            let vector_db_path = index_dir.join("vectors.db");
            let vector_store = index::vector::VectorStore::open(&vector_db_path)?;

            for record in &records {
                if record.is_binary {
                    continue;
                }
                match std::fs::read_to_string(&record.path) {
                    Ok(content) => {
                        let ext = std::path::Path::new(&record.path)
                            .extension()
                            .and_then(|e| e.to_str())
                            .unwrap_or("");
                        let language = index::chunker::language_from_ext(ext);
                        let chunks = index::chunker::chunk_file(
                            &content,
                            &record.path,
                            &record.relative_path,
                            language,
                        );
                        vector_store.insert_chunks(&chunks, embedder.as_ref())?;
                        tantivy_index.index_chunks(&chunks)?;
                    }
                    Err(e) => error!("Failed to read {}: {}", record.path, e),
                }
            }

            let hash_store =
                index::incremental::ContentHashStore::open(&index_dir.join("hashes.sled"))?;
            for record in &records {
                if let Ok(content) = std::fs::read_to_string(&record.path) {
                    hash_store.update_hash(&record.path, content.as_bytes())?;
                }
            }
            hash_store.flush()?;

            info!(
                "Indexed {} files, {} chunks",
                records.len(),
                vector_store.chunk_count().unwrap_or(0)
            );

            if *watch {
                info!("Starting file watcher on {:?}", path);
                let mut watch_rx = index::watcher::start_watch(path, 500);

                while let Some(event) = watch_rx.recv().await {
                    match event {
                        index::watcher::WatchEvent::Modified(paths) => {
                            info!("Detected {} changes, reindexing...", paths.len());
                            for p in &paths {
                                let p_path = std::path::Path::new(p);
                                if !p_path.is_file() {
                                    continue;
                                }
                                let content = match std::fs::read_to_string(p) {
                                    Ok(c) => c,
                                    Err(_) => continue,
                                };

                                let changed = hash_store.has_changed(p, content.as_bytes())?;
                                if !changed {
                                    continue;
                                }

                                let relative = p_path
                                    .strip_prefix(path)
                                    .unwrap_or(p_path)
                                    .to_string_lossy()
                                    .to_string();
                                let ext = p_path
                                    .extension()
                                    .and_then(|e| e.to_str())
                                    .unwrap_or("");
                                let language = index::chunker::language_from_ext(ext);

                                let chunks = index::chunker::chunk_file(
                                    &content,
                                    p,
                                    &relative,
                                    language,
                                );

                                vector_store.remove_file(p)?;
                                vector_store.insert_chunks(&chunks, embedder.as_ref())?;

                                tantivy_index = index::search::SearchIndex::open(&index_dir)?;
                                tantivy_index.set_embedder(embedder.clone());
                                tantivy_index.index_chunks(&chunks)?;

                                hash_store.update_hash(p, content.as_bytes())?;
                                info!("  Reindexed: {}", p);
                            }
                            hash_store.flush()?;
                        }
                        index::watcher::WatchEvent::Error(e) => {
                            error!("Watcher error: {}", e);
                        }
                    }
                }
            }
        }
        Commands::Watch { path } => {
            let index_dir = index::storage::index_dir();
            let embedder = Arc::new(index::embed::HashEmbedder::new());

            info!("Watching {:?} for changes...", path);
            let mut watch_rx = index::watcher::start_watch(path, 500);

            while let Some(event) = watch_rx.recv().await {
                match event {
                    index::watcher::WatchEvent::Modified(paths) => {
                        info!("Detected {} changes", paths.len());
                        for p in &paths {
                            let p_path = std::path::Path::new(p);
                            if !p_path.is_file() {
                                continue;
                            }
                            let content = match std::fs::read_to_string(p) {
                                Ok(c) => c,
                                Err(_) => continue,
                            };

                            let relative = p_path
                                .strip_prefix(path)
                                .unwrap_or(p_path)
                                .to_string_lossy()
                                .to_string();
                            let ext = p_path.extension().and_then(|e| e.to_str()).unwrap_or("");
                            let language = index::chunker::language_from_ext(ext);
                            let chunks = index::chunker::chunk_file(
                                &content,
                                p,
                                &relative,
                                language,
                            );

                            let vector_db_path = index_dir.join("vectors.db");
                            if let Ok(vs) = index::vector::VectorStore::open(&vector_db_path) {
                                let _ = vs.remove_file(p);
                                let _ = vs.insert_chunks(&chunks, embedder.as_ref());
                            }

                            if let Ok(mut si) = index::search::SearchIndex::open(&index_dir) {
                                si.set_embedder(embedder.clone());
                                let _ = si.index_chunks(&chunks);
                            }

                            info!("  Reindexed: {}", p);
                        }
                    }
                    index::watcher::WatchEvent::Error(e) => {
                        error!("Watcher error: {}", e);
                    }
                }
            }
        }
        Commands::List => {
            let index_dir = index::storage::index_dir();
            let records = index::storage::load_metadata(&index_dir)?;
            if records.is_empty() {
                println!("No indexed files. Run `indexer index --path DIR` first.");
            } else {
                println!("Indexed files ({} total):", records.len());
                for r in &records {
                    println!("  {}  ({}, {} bytes)", r.path, r.language, r.size_bytes);
                }
            }
        }
        Commands::Daemon { action } => {
            daemon::handle_daemon_action(action).await?;
        }
        Commands::Query {
            pattern,
            lang,
            path,
            limit,
        } => {
            let index_dir = index::storage::index_dir();
            let searcher = index::search::SearchIndex::open(&index_dir)?;
            let results = searcher.search(pattern, lang.as_deref(), path.as_deref(), *limit)?;
            println!("Found {} matches for '{}':", results.len(), pattern);
            for r in &results {
                println!("  {}:{}  {}", r.filepath, r.line, r.text);
            }
        }
        Commands::Semantic { query, limit } => {
            let index_dir = index::storage::index_dir();
            let mut searcher = index::search::SearchIndex::open(&index_dir)?;
            let embedder = Arc::new(index::embed::HashEmbedder::new());
            searcher.set_embedder(embedder);

            match searcher.semantic_search(query, *limit) {
                Ok(results) => {
                    println!("Top {} semantic matches for '{}':", results.len(), query);
                    for r in &results {
                        println!(
                            "  {}:{}  {}  (score: {:.4})",
                            r.filepath, r.line, r.text, r.score
                        );
                    }
                }
                Err(e) => {
                    error!("Semantic search failed: {}", e);
                    // Fall back to BM25-only
                    let results = searcher.bm25_search(query, None, None, *limit)?;
                    println!(
                        "Top {} BM25 matches for '{}' (no embeddings):",
                        results.len(),
                        query
                    );
                    for r in &results {
                        println!("  {}:{}  {}", r.filepath, r.line, r.text);
                    }
                }
            }
        }
        Commands::Find { name, root } => {
            let files = walker::find_files(name, root.to_string_lossy().as_ref());
            for f in files {
                println!("{}", f);
            }
        }
        Commands::Glob { pattern, base } => {
            match walker::glob_files(pattern, base.to_string_lossy().as_ref()) {
                Ok(files) => {
                    for f in files {
                        println!("{}", f);
                    }
                }
                Err(e) => error!("Glob error: {}", e),
            }
        }
        Commands::Undo => {
            match daemon::send_rpc("rollback", serde_json::json!({})).await {
                Ok(res) => {
                    let status = res.get("status").and_then(|v| v.as_str()).unwrap_or("unknown");
                    println!("{}", status);
                }
                Err(e) => {
                    error!("Rollback failed: {}. Is the daemon running? (start with `indexer daemon start`)", e);
                }
            }
        }
        Commands::Shadow => {
            match daemon::list_shadow_backups() {
                Ok(entries) if entries.is_empty() => {
                    println!("No shadow backups available. Files have not been modified through the daemon.");
                }
                Ok(entries) => {
                    println!("Shadow backups available for rollback ({} total):", entries.len());
                    println!("  Use `indexer undo` to restore all files to pre-write state.");
                    println!();
                    for entry in &entries {
                        println!("  {}", entry.original_path);
                    }
                }
                Err(e) => {
                    error!("Failed to list shadow backups: {}", e);
                }
            }
        }
    }

    Ok(())
}
