//! SANDBOX Cage (Open-Core)
//!
//! Minimal execution core. File classification + runner routing only.
//! No WASM, no audit chain, no threat DB, no quarantine.

use anyhow::{bail, Result};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;

pub mod policy;
pub mod verdict;
pub mod sandbox;
pub mod cgroups;

use policy::SecurityMode;
use verdict::CageResult;

const DEFAULT_FUEL_LIMIT: u64 = 1_000_000_000;
const MAX_WASM_STACK: usize = 1 << 20;
const AUDIT_RING_BUFFER_CAPACITY: usize = 10_000;

#[derive(Debug, Clone)]
pub enum Verdict {
    Allowed { output: String },
    Blocked { reason: String },
    Timeout,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AuditEntry {
    pub timestamp: String,
    pub severity: Severity,
    pub action: String,
    pub reason: String,
    pub request_id: uuid::Uuid,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum Severity {
    Critical,
    High,
    Medium,
    Low,
}

static AUDIT_RING: Mutex<Option<AuditRingBuffer>> = Mutex::new(None);

struct AuditRingBuffer {
    entries: VecDeque<AuditEntry>,
    capacity: usize,
}

impl AuditRingBuffer {
    fn new(capacity: usize) -> Self {
        Self { entries: VecDeque::with_capacity(capacity), capacity }
    }
    fn push(&mut self, entry: AuditEntry) {
        if self.entries.len() >= self.capacity {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }
    fn entries(&self) -> &VecDeque<AuditEntry> { &self.entries }
}

fn get_or_init_ring() -> &'static Mutex<Option<AuditRingBuffer>> {
    let mut guard = AUDIT_RING.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_none() {
        *guard = Some(AuditRingBuffer::new(AUDIT_RING_BUFFER_CAPACITY));
    }
    drop(guard);
    &AUDIT_RING
}

/// Log an intercept event (simplified open-core — no tamper chain)
pub fn log_intercept(severity: Severity, action: &str, reason: &str, request_id: uuid::Uuid) {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let log_line = format!("[{}] [{:?}] [{}] [{}]", timestamp, severity, action, reason);
    tracing::info!("{}", log_line);

    let entry = AuditEntry {
        timestamp,
        severity,
        action: action.to_string(),
        reason: reason.to_string(),
        request_id,
    };

    let ring = get_or_init_ring();
    if let Ok(mut guard) = ring.lock() {
        if let Some(ref mut buf) = *guard {
            buf.push(entry);
        }
    }
}

/// Classify and route a file to the appropriate runner
pub fn run_cage(input: PathBuf, mode: SecurityMode, _fuel: Option<u64>) -> Result<CageResult> {
    use crate::classifier::FileClassifier;
    let request_id = uuid::Uuid::new_v4();

    tracing::info!("[{}] Starting cage execution: {} with mode {:?}", request_id, input.display(), mode);

    if !input.exists() {
        let reason = format!("Input file not found: {}", input.display());
        log_intercept(Severity::High, "EXECUTE_BLOCKED", &reason, request_id);
        return Ok(CageResult::blocked(&reason));
    }

    const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024;
    let metadata = std::fs::metadata(&input)?;
    if metadata.len() > MAX_FILE_SIZE {
        let reason = format!("File too large: {}MB. Limit is 100MB.", metadata.len() / 1024 / 1024);
        log_intercept(Severity::High, "EXECUTE_BLOCKED", &reason, request_id);
        return Ok(CageResult::blocked(&reason));
    }

    let classifier = FileClassifier::new();
    let classification = classifier.classify(&input)?;

    use crate::runner::{RunnerRouter, RunnerVerdict};
    let router = RunnerRouter::new();

    match router.route(&input, &classification, mode) {
        Ok(RunnerVerdict::Success { output }) => {
            log_intercept(Severity::Low, "EXECUTE_ALLOWED", &output, request_id);
            Ok(CageResult::allowed(&output))
        }
        Ok(RunnerVerdict::Blocked { reason }) => {
            log_intercept(Severity::High, "EXECUTE_BLOCKED", &reason, request_id);
            Ok(CageResult::blocked(&reason))
        }
        Ok(RunnerVerdict::Timeout) => {
            log_intercept(Severity::High, "EXECUTE_TIMEOUT", "Fuel exhausted", request_id);
            Ok(CageResult::timeout())
        }
        Ok(RunnerVerdict::Unsupported { reason }) => {
            log_intercept(Severity::Medium, "EXECUTE_UNSUPPORTED", &reason, request_id);
            Ok(CageResult::unsupported(&reason))
        }
        Err(e) => {
            let reason = format!("Execution error: {}", e);
            log_intercept(Severity::High, "EXECUTE_ERROR", &reason, request_id);
            Ok(CageResult::error(&reason))
        }
    }
}

/// Static analysis check (dry-run)
pub fn check(input: PathBuf) -> Result<()> {
    use crate::classifier::FileClassifier;

    if !input.exists() {
        bail!("Input file not found: {}", input.display());
    }

    const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024;
    let metadata = std::fs::metadata(&input)?;
    if metadata.len() > MAX_FILE_SIZE {
        return Err(anyhow::anyhow!("File too large: {}MB.", metadata.len() / 1024 / 1024));
    }

    let classifier = FileClassifier::new();
    let classification = classifier.classify(&input)?;

    println!("File: {}", input.display());
    println!("  Type: {:?}", classification.class);
    println!("  Size: {} bytes", classification.file_size);

    let router = crate::runner::RunnerRouter::new();
    let deps = router.check_all_dependencies();

    println!("\nDependencies:");
    for (runner_name, statuses) in deps {
        println!("  {}:", runner_name);
        for status in statuses {
            let s = if status.available { "✓" } else { "✗" };
            println!("    {} {} ({})", s, status.name, status.version.as_deref().unwrap_or("unknown"));
        }
    }

    Ok(())
}
