#![allow(dead_code, unused_variables)]
mod auto_context;
mod clients;
mod daemon;
mod executor;
mod hardware;
mod history;
mod llm_client;
mod markdown;
mod mcp;
mod model_profile;
mod review;
mod schema;
mod session;
mod socket;
mod stream_parser;
mod types;
mod ui;
mod workspace;

use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let model_name_str =
        std::env::var("UNIT01_MODEL").unwrap_or_else(|_| "qwen2.5-coder:3b".to_string());

    let model_name = model_name_str.clone();

    let mut llm = llm_client::LLMClient::new(&model_name);
    let profile = model_profile::ModelProfile::load(&mut llm).await;

    let daemon_mgr = Arc::new(daemon::DaemonManager::new());
    let mut ws = workspace::Workspace::new();
    let mcp_mgr = Arc::new(mcp::MCPManager::new());

    mcp_mgr.load_config().await;

    let indexer_status = daemon_mgr
        .spawn_if_missing("indexer", "/tmp/ruthen/indexer.sock")
        .await;
    let sandbox_status = daemon_mgr
        .spawn_if_missing("sandbox", "/tmp/ruthen/sandbox.sock")
        .await;

    // SIGTERM handler
    {
        let daemon_mgr = daemon_mgr.clone();
        let mcp_mgr = mcp_mgr.clone();
        tokio::spawn(async move {
            let mut sig =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).unwrap();
            sig.recv().await;
            mcp_mgr.shutdown().await;
            daemon_mgr.shutdown().await;
            std::process::exit(0);
        });
    }

    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "/".to_string());
    ws.set(&cwd).await;

    let ram = hardware::system_ram_gb();

    eprintln!("◆ UNIT-01 SOVEREIGN ENGINE [BOOTED]");
    eprintln!(
        "◆ Model: {} ({}) | Context: {} | RAM: {}GB",
        profile.name, profile.parameter_size, profile.context_window, ram
    );
    eprintln!("◆ Workspace: {}", cwd);

    // ─── UDS LISTENER ──────────────────────────────────────────────
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<socket::SiblingMessage>();

    let tx_for_listener = tx.clone();
    tokio::spawn(async move {
        socket::run_uds_listener(tx_for_listener).await;
    });

    // ─── LAUNCH UI ─────────────────────────────────────────────────
    let app_state = Arc::new(Mutex::new(ui::AppState {
        messages: Vec::new(),
        input: String::new(),
        thinking: false,
        current_response: String::new(),
        status_label: String::new(),
        cmd_model_name: model_name_str.clone(),
        model_name: profile.name.clone(),
        model_size: profile.parameter_size.clone(),
        indexer_online: indexer_status == daemon::DaemonStatus::Ready,
        sandbox_online: sandbox_status == daemon::DaemonStatus::Ready,
        ws,
        profile,
        llm,
        daemon_mgr,
        mcp_mgr: mcp_mgr.clone(),
        history: history::History::new(),
        history_messages: Vec::new(),
        tool_count: mcp_mgr.tool_count().await,
    }));

    ui::run_ui(app_state, rx).await;
}
