mod daemon;
mod file_ops;
mod index;
mod models;
mod walker;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tracing::{error, info, Level};
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
    /// Full index of a directory
    Index {
        #[arg(short, long, default_value = ".")]
        path: PathBuf,
    },
    /// List indexed files
    List,
    /// Manage the Indexer background daemon
    Daemon {
        #[command(subcommand)]
        action: DaemonAction,
    },
    /// Query the indexed files
    Query {
        pattern: String,
        #[arg(short, long)]
        lang: Option<String>,
        #[arg(short, long)]
        path: Option<String>,
        #[arg(long, default_value = "20")]
        limit: usize,
        #[arg(long, default_value = "0")]
        offset: usize,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let write_lock: Arc<Mutex<()>> = Arc::new(Mutex::new(()));
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .finish();
    tracing::subscriber::set_global_default(subscriber).expect("setting default subscriber failed");

    let cli = Cli::parse();

    match &cli.command {
        Commands::Index { path } => {
            info!("Starting index command for {:?}", path);
            let walker = walker::Walker::new(path);
            let records = walker.walk();

            let index_dir = file_ops::get_index_dir();
            let storage =
                index::storage::Storage::open(&index_dir).expect("Failed to open index storage");
            let manager = file_ops::IndexManager::new(storage, write_lock.clone());

            match manager.write_index(records) {
                Ok(_) => info!(
                    "Successfully indexed files into Sled store at {:?}",
                    index_dir
                ),
                Err(e) => error!("Failed to save index: {}", e),
            }
        }
        Commands::List => {
            let index_dir = file_ops::get_index_dir();
            let storage =
                index::storage::Storage::open(&index_dir).expect("Failed to open index storage");
            let records = storage.list_records().expect("Failed to list records");
            if records.is_empty() {
                println!("No indexed files. Run `indexer index --path DIR` first.");
            } else {
                println!("Indexed files ({} total):", records.len());
                for r in &records {
                    println!(
                        "  {}  ({}, {} bytes, {})",
                        r.path, r.language, r.size_bytes, r.indexed_at
                    );
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
            offset,
        } => {
            let index_dir = file_ops::get_index_dir();
            let storage =
                index::storage::Storage::open(&index_dir).expect("Failed to open index storage");
            let engine = index::query::QueryEngine::new(storage);

            let results = engine
                .execute(pattern, lang.as_deref(), path.as_deref(), *limit, *offset)
                .expect("Query execution failed");

            println!("Found {} matches for '{}':", results.len(), pattern);
            for record in results {
                println!("- {}", record.path);
            }
        }
    }

    Ok(())
}
