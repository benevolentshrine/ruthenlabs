mod daemon;
mod index;
mod models;
mod walker;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
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
    },
    /// List indexed files
    List,
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
        Commands::Index { path } => {
            info!("Indexing {:?}", path);
            let index_dir = index::storage::index_dir();
            let mut tantivy_index = index::search::SearchIndex::open(&index_dir)?;
            let records = walker::Walker::new(path).walk();
            index::storage::save_metadata(&index_dir, &records)?;
            tantivy_index.index_records(&records, path)?;
            info!("Indexed {} files", records.len());
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
            let searcher = index::search::SearchIndex::open(&index_dir)?;
            let results = searcher.semantic_search(query, *limit)?;
            println!("Top {} semantic matches:", results.len());
            for r in &results {
                println!("  {}:{}  {}", r.filepath, r.line, r.text);
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
    }

    Ok(())
}
