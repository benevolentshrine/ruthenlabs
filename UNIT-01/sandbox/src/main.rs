use anyhow::Result;
use clap::Parser;
use sandbox::socket;
use std::path::PathBuf;
use std::process::ExitCode;

/// SANDBOX — Kernel-isolated execution daemon
#[derive(Parser)]
#[command(name = "sandbox")]
#[command(about = "Kernel-isolated execution daemon for UNIT-01")]
#[command(version = "0.4.0")]
struct Cli {
    /// Socket path (default: /tmp/ruthen/sandbox.sock)
    #[arg(long)]
    socket: Option<PathBuf>,
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
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(socket::run_daemon(cli.socket))?;
    Ok(())
}
