//! SANDBOX Socket Stubs — Reserved for INDEXER and ORCHESTRATOR
//!
//! These are placeholder stubs for the Trinity architecture.
//! DO NOT implement INDEXER or ORCHESTRATOR logic here — that lives in their own repositories.
//!
//! GATE 3: Socket Contract Freeze
//! - INDEXER socket: [TEMP]/sumi/indexer.sock
//! - ORCHESTRATOR socket: [TEMP]/sumi/orchestrator.sock
//! - SANDBOX socket: [TEMP]/sumi/sandbox.sock (active)

#![allow(dead_code)]

use crate::socket::config::{indexer_socket_path, orchestrator_socket_path, sandbox_socket_path};
use std::path::Path;

/// Stub function for INDEXER socket operations
///
/// INDEXER is the Rust indexer — context retrieval engine.
/// SANDBOX never calls INDEXER directly. INDEXER may call SANDBOX.
pub fn indexer_stub() -> anyhow::Result<()> {
    // This is intentionally a stub.
    // INDEXER implementation lives in the INDEXER repository.
    Ok(())
}

/// Stub function for ORCHESTRATOR socket operations
///
/// ORCHESTRATOR is the Go router — request orchestration layer.
/// SANDBOX never calls ORCHESTRATOR. ORCHESTRATOR calls SANDBOX.
pub fn orchestrator_stub() -> anyhow::Result<()> {
    // This is intentionally a stub.
    // ORCHESTRATOR implementation lives in the ORCHESTRATOR repository.
    Ok(())
}

/// Validate that a socket path is one of the Trinity paths
pub fn validate_trinity_path(path: &Path) -> bool {
    path == sandbox_socket_path()
        || path == indexer_socket_path()
        || path == orchestrator_socket_path()
}
