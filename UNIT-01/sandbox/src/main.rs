#![allow(dead_code)]

use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process::ExitCode;

mod cage;
mod classifier;
mod config;
mod runner;
mod shadow;
mod socket;
mod tui;

/// SANDBOX — Security Cage Engine for Project RUTHENLABS (Open-Core)
#[derive(Parser)]
#[command(name = "sandbox")]
#[command(about = "SANDBOX Security Cage — Kernel-isolated execution daemon")]
#[command(version = "0.3.0")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the socket daemon
    Daemon {
        /// Socket path (default: /tmp/ruthen/sandbox.sock)
        #[arg(long)]
        socket: Option<PathBuf>,
    },

    /// Execute code in the security cage
    Cage {
        #[arg(short, long)]
        input: PathBuf,
        #[arg(long, value_name = "MODE", default_value = "run")]
        mode: String,
        #[arg(long, value_name = "N")]
        fuel: Option<u64>,
    },

    /// Launch TUI dashboard
    Tui {
        /// Socket path (default: /tmp/ruthen/sandbox.sock)
        #[arg(long)]
        socket: Option<PathBuf>,
    },

    /// Filesystem rollback
    Rollback {
        #[arg(long, value_name = "ID")]
        session: Option<String>,
        #[arg(long)]
        dry_run: bool,
        #[arg(long)]
        list: bool,
        #[arg(long, value_name = "ID")]
        clear: Option<String>,
    },
}

fn main() -> ExitCode {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("sandbox=info")
        .try_init();

    if let Err(e) = run() {
        eprintln!("Error: {}", e);
        return ExitCode::from(2);
    }
    ExitCode::SUCCESS
}

fn run() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Daemon { socket } => {
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(socket::run_daemon(socket))?;
        }
        Commands::Tui { socket } => {
            tui::run(socket)?;
        }
        Commands::Cage { input, mode, fuel } => {
            use cage::policy::SecurityMode;
            let security_mode = SecurityMode::from(mode.as_str());
            let result = cage::run_cage(input, security_mode, fuel)?;
            println!("{}", result);
        }
        Commands::Rollback { session, dry_run, list, clear } => {
            let manager = shadow::RollbackManager::new()?;
            if list {
                let sessions = manager.list_sessions()?;
                if sessions.is_empty() {
                    println!("No shadow backups found.");
                } else {
                    println!("Shadow Backups:");
                    for info in sessions {
                        println!("  {} | {} | {} files", info.session_id, info.created, info.file_count);
                    }
                }
            } else if let Some(ref session_id) = session {
                if dry_run {
                    let files = manager.dry_run(session_id)?;
                    println!("Dry-run rollback for session {}:", session_id);
                    for f in &files {
                        println!("  Would restore: {}", f.display());
                    }
                    println!("\n{} files would be restored.", files.len());
                } else {
                    let result = manager.rollback(session_id)?;
                    println!("Restored: {} files", result.success_count());
                    if result.failure_count() > 0 {
                        println!("Failed: {} files", result.failure_count());
                    }
                }
            } else if let Some(session_id) = clear {
                manager.clear(&session_id)?;
                println!("Cleared shadow for session: {}", session_id);
            }
        }
    }

    Ok(())
}
