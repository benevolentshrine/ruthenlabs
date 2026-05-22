//! SANDBOX Scanner — File analysis and detection utilities
//!
//! This module provides:
//! - Entropy scanning for packed/obfuscated detection
//! - Directory scanning for batch analysis

pub mod entropy;
pub mod dirscan;

pub use dirscan::{DirectoryScanner, ScanResult, Verdict};
