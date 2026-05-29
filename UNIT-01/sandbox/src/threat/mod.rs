//! SANDBOX Threat Intelligence — Malware detection and hash database
//!
//! Provides:
//! - Local hash database for known malware detection
//! - Offline threat intelligence (no cloud dependencies)

pub mod hashdb;

pub use hashdb::{compute_file_hash, HashDB, HashEntry, HashStatus, Severity};
