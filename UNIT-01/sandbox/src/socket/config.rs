//! Sandbox Socket Configuration
//!
//! GATE 3: All socket paths centralized here. No hardcoded paths elsewhere.
//!
//! Socket paths for Ruthen Labs Ecosystem:
//! - SANDBOX: [TEMP]/ruthen/sandbox.sock (security engine)
//! - INDEXER: [TEMP]/ruthen/indexer.sock (indexer)
//! - ORCHESTRATOR: [TEMP]/ruthen/orchestrator.sock (orchestrator/conductor)
//!
//! Unix Philosophy: Auto-discover siblings via filesystem sockets.
//! No hardcoded ports. No localhost HTTP. Pure Unix sockets.

use std::path::{Path, PathBuf};

/// Base directory for Ruthen ecosystem
pub fn ruthen_base_dir() -> PathBuf {
    #[cfg(unix)]
    {
        PathBuf::from("/tmp/ruthen")
    }
    #[cfg(not(unix))]
    {
        std::env::temp_dir().join("ruthen")
    }
}

/// Default Sandbox socket path
pub fn sandbox_socket_path() -> PathBuf {
    ruthen_base_dir().join("sandbox.sock")
}

/// Orchestrator socket path
pub fn orchestrator_socket_path() -> PathBuf {
    ruthen_base_dir().join("orchestrator.sock")
}

/// Indexer socket path
#[allow(dead_code)]
pub fn indexer_socket_path() -> PathBuf {
    ruthen_base_dir().join("indexer.sock")
}

/// Maximum request size: 10MB
pub const MAX_REQUEST_SIZE: usize = 10 * 1024 * 1024;

/// Socket directory path
pub fn socket_dir() -> PathBuf {
    ruthen_base_dir()
}

/// Sandbox workspace directory for file operations
#[allow(dead_code)]
pub fn sandbox_workspace_dir() -> PathBuf {
    ruthen_base_dir().join("workspace")
}

/// Service discovery: Check if a sibling service is running
pub fn is_service_available<P: AsRef<Path>>(socket_path: P) -> bool {
    socket_path.as_ref().exists()
}

/// Check if Orchestrator is available
pub fn orchestrator_available() -> bool {
    is_service_available(orchestrator_socket_path())
}

/// Check if Indexer is available
pub fn indexer_available() -> bool {
    is_service_available(indexer_socket_path())
}

/// Get ecosystem status - which siblings are present
pub fn ecosystem_status() -> EcosystemStatus {
    EcosystemStatus {
        sandbox: true, // We're here
        orchestrator: orchestrator_available(),
        indexer: indexer_available(),
    }
}

/// Ecosystem presence detection
#[derive(Debug, Clone)]
pub struct EcosystemStatus {
    pub sandbox: bool,
    pub orchestrator: bool,
    pub indexer: bool,
}

impl EcosystemStatus {
    /// Check if we're running in full ecosystem mode
    pub fn full_ecosystem() -> bool {
        let status = ecosystem_status();
        status.sandbox && status.orchestrator && status.indexer
    }

    /// Get count of available services
    pub fn service_count(&self) -> usize {
        let mut count = 0;
        if self.sandbox { count += 1; }
        if self.orchestrator { count += 1; }
        if self.indexer { count += 1; }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_socket_paths() {
        #[cfg(unix)]
        let base = PathBuf::from("/tmp/ruthen");
        #[cfg(not(unix))]
        let base = std::env::temp_dir().join("ruthen");
        assert_eq!(sandbox_socket_path(), base.join("sandbox.sock"));
        assert_eq!(orchestrator_socket_path(), base.join("orchestrator.sock"));
        assert_eq!(indexer_socket_path(), base.join("indexer.sock"));
        assert_eq!(MAX_REQUEST_SIZE, 10 * 1024 * 1024);
    }

    #[test]
    fn test_ecosystem_status() {
        // Just verify it doesn't panic
        let status = ecosystem_status();
        assert!(status.sandbox); // We exist
        // Other values depend on runtime state
    }
}
