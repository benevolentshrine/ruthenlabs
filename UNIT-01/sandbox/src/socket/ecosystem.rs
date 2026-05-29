//! SANDBOX Ecosystem Integration — Auto-discovery and communication with RUTHENLABS siblings
//!
//! Unix Philosophy: Discover siblings via filesystem sockets, not localhost ports.
//! If siblings are present → collaborate. If not → work standalone.
//!
//! Pattern: " sandbox check --input file.rs " works alone.
//!          When orchestrator is present, it calls sandbox via socket and renders results.
//!          When indexer is present, sandbox queries it for file context.

use crate::cage::policy::SecurityMode;
use crate::socket::config::EcosystemStatus;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Ecosystem service capability advertisement
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceCapabilities {
    pub service: String,
    pub version: String,
    pub features: Vec<String>,
    pub mode: String,
}

/// Event broadcast to siblings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EcosystemEvent {
    pub source: String,
    pub event_type: String,
    pub severity: String,
    pub message: String,
    pub path: Option<String>,
    pub timestamp: String,
}

/// Context request to Indexer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerContextRequest {
    pub file_path: String,
}

/// Context response from Indexer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexerContextResponse {
    pub file_path: String,
    pub references: Vec<String>,
    pub language: Option<String>,
    pub context_summary: Option<String>,
}

/// Check full ecosystem status
pub fn status() -> EcosystemStatus {
    super::config::ecosystem_status()
}

/// Query Indexer for file context (if available)
pub async fn query_indexer_context(file_path: &Path) -> Option<IndexerContextResponse> {
    if !super::config::indexer_available() {
        return None;
    }

    #[cfg(unix)]
    {
        match query_indexer_unix(file_path).await {
            Ok(resp) => Some(resp),
            Err(e) => {
                tracing::debug!("Failed to query Indexer: {}", e);
                None
            }
        }
    }

    #[cfg(windows)]
    {
        // Windows: Indexer would use TCP localhost
        None // TODO: Implement Windows discovery
    }
}

#[cfg(unix)]
async fn query_indexer_unix(file_path: &Path) -> Result<IndexerContextResponse> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;

    let request = IndexerContextRequest {
        file_path: file_path.to_string_lossy().to_string(),
    };

    let mut stream = UnixStream::connect(super::config::indexer_socket_path())
        .await
        .context("Failed to connect to Indexer socket")?;

    let request_bytes = serde_json::to_vec(&request)?;
    stream.write_all(&request_bytes).await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;

    // Read response
    let mut buffer = vec![0u8; 65536];
    let n = stream.read(&mut buffer).await?;
    buffer.truncate(n);

    let response: IndexerContextResponse = serde_json::from_slice(&buffer)?;
    Ok(response)
}

/// Notify Orchestrator of an event (if available)
pub async fn notify_orchestrator(event: EcosystemEvent) {
    if !super::config::orchestrator_available() {
        return;
    }

    #[cfg(unix)]
    {
        if let Err(e) = notify_orchestrator_unix(event).await {
            tracing::debug!("Failed to notify Orchestrator: {}", e);
        }
    }
}

#[cfg(unix)]
async fn notify_orchestrator_unix(event: EcosystemEvent) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    use tokio::net::UnixStream;

    let mut stream = UnixStream::connect(super::config::orchestrator_socket_path())
        .await
        .context("Failed to connect to Orchestrator socket")?;

    let event_bytes = serde_json::to_vec(&event)?;
    stream.write_all(&event_bytes).await?;
    stream.write_all(b"\n").await?;
    stream.flush().await?;

    Ok(())
}

/// Broadcast a security event to all siblings
pub async fn broadcast_event(event_type: &str, severity: &str, message: &str, path: Option<&Path>) {
    let event = EcosystemEvent {
        source: "sandbox".to_string(),
        event_type: event_type.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        path: path.map(|p| p.to_string_lossy().to_string()),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    // Notify Orchestrator if available
    notify_orchestrator(event).await;
}

/// Format capabilities for service advertisement
pub fn get_capabilities(mode: SecurityMode) -> ServiceCapabilities {
    ServiceCapabilities {
        service: "sandbox".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        features: vec![
            "scan".to_string(),
            "cage".to_string(),
            "watchdog".to_string(),
            "quarantine".to_string(),
            "audit".to_string(),
            "rollback".to_string(),
        ],
        mode: format!("{:?}", mode),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_capabilities() {
        let caps = get_capabilities(SecurityMode::Audit);
        assert_eq!(caps.service, "sandbox");
        assert!(caps.features.contains(&"scan".to_string()));
    }

    #[test]
    fn test_ecosystem_event_serialization() {
        let event = EcosystemEvent {
            source: "sandbox".to_string(),
            event_type: "FILE_BLOCKED".to_string(),
            severity: "CRITICAL".to_string(),
            message: "Test message".to_string(),
            path: Some("/test.txt".to_string()),
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("FILE_BLOCKED"));
        assert!(json.contains("sandbox"));
    }
}
