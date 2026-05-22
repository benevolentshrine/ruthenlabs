//! SANDBOX Pre-Execution Gate (v2.0)
//!
//! This is the first enforcement point in the SANDBOX security pipeline.
//! It validates tool call categories against the `security_policy.yaml` manifest
//! BEFORE any fork() happens — before the kernel even sees the request.
//!
//! The gate answers one question:
//!   "Does this requested action category match the user's declared policy?"
//!
//! If the answer is NO, the execution is blocked immediately with a structured
//! audit log entry, and no child process is ever created.
//!
//! Policy file location: `~/.config/sandbox/security_policy.yaml`
//! A default policy is seeded from `src/config/security_policy.yaml` on first run.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// Policy Manifest Structures (mirrors security_policy.yaml schema)
// ---------------------------------------------------------------------------

/// Top-level security policy manifest (deserialized from YAML)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityManifest {
    /// Manifest version (must be "2.0")
    pub version: String,

    /// Paths made invisible inside the sandbox (not in Landlock allowlist)
    #[serde(default)]
    pub invisible_inside_sandbox: Vec<String>,

    /// Tool call categories allowed to proceed
    #[serde(default)]
    pub allowed_tool_categories: Vec<String>,

    /// Tool call categories blocked immediately
    #[serde(default)]
    pub denied_tool_categories: Vec<String>,

    /// Cgroup v2 resource limits
    #[serde(default)]
    pub resource_limits: ResourceLimits,

    /// Audit configuration
    #[serde(default)]
    pub audit: AuditConfig,
}

/// Resource limits enforced by Cgroups v2
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// Memory limit in MB (default: 512)
    #[serde(default = "default_memory_mb")]
    pub memory_mb: u64,

    /// CPU quota as percentage of one core (default: 25)
    #[serde(default = "default_cpu_percent")]
    pub cpu_percent: u32,

    /// Maximum number of PIDs in the cgroup (default: 20)
    #[serde(default = "default_pids_max")]
    pub pids_max: u32,

    /// Wallclock execution timeout in seconds (default: 30)
    #[serde(default = "default_timeout_secs")]
    pub max_execution_seconds: u64,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            memory_mb: default_memory_mb(),
            cpu_percent: default_cpu_percent(),
            pids_max: default_pids_max(),
            max_execution_seconds: default_timeout_secs(),
        }
    }
}

/// Audit configuration
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AuditConfig {
    #[serde(default = "default_true")]
    pub log_all_decisions: bool,

    #[serde(default = "default_true")]
    pub log_resource_violations: bool,

    #[serde(default = "default_critical")]
    pub denied_category_severity: String,
}

// Default value functions for serde
fn default_memory_mb() -> u64 { 512 }
fn default_cpu_percent() -> u32 { 25 }
fn default_pids_max() -> u32 { 20 }
fn default_timeout_secs() -> u64 { 30 }
fn default_true() -> bool { true }
fn default_critical() -> String { "Critical".to_string() }

// ---------------------------------------------------------------------------
// Gate Decision
// ---------------------------------------------------------------------------

/// The decision produced by the Pre-Execution Gate
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GateDecision {
    /// Proceed to kernel enforcement layers (Landlock → Seccomp → Cgroups)
    Proceed,
    /// Block immediately, before any fork(). Attach reason for audit log.
    Block { reason: String },
}

// ---------------------------------------------------------------------------
// Pre-Execution Gate
// ---------------------------------------------------------------------------

/// The Pre-Execution Gate: validates tool call categories against the YAML policy.
pub struct PreExecutionGate {
    policy: SecurityManifest,
    /// Path the policy was loaded from
    policy_path: PathBuf,
}

impl PreExecutionGate {
    /// Load the gate from the user's policy file.
    ///
    /// If the file doesn't exist, it is seeded from the embedded default and
    /// a secure default manifest is returned.
    pub fn load() -> Result<Self> {
        let policy_path = Self::policy_path()?;

        let policy = if policy_path.exists() {
            let content = std::fs::read_to_string(&policy_path)
                .with_context(|| format!("Failed to read policy: {}", policy_path.display()))?;

            serde_yaml::from_str(&content)
                .with_context(|| format!("Failed to parse policy YAML: {}", policy_path.display()))?
        } else {
            tracing::info!(
                "[GATE] Policy file not found at {}. Using embedded defaults.",
                policy_path.display()
            );
            // Seed the default policy file
            Self::seed_default_policy(&policy_path)?;
            Self::default_policy()
        };

        // Validate version
        if policy.version != "2.0" {
            tracing::warn!(
                "[GATE] Policy version '{}' may be incompatible with v2.0 gate. \
                 Update {} to version '2.0'.",
                policy.version,
                policy_path.display()
            );
        }

        Ok(PreExecutionGate { policy, policy_path })
    }

    /// Validate a tool call category against the loaded policy.
    ///
    /// Check order: denied_tool_categories → allowed_tool_categories → default deny.
    pub fn validate(&self, action_category: &str) -> GateDecision {
        let category = action_category.to_lowercase();

        // 1. Explicit deny check (highest priority)
        if self.policy.denied_tool_categories.iter().any(|d| d.to_lowercase() == category) {
            let reason = format!(
                "[GATE v2.0] Action category '{}' is explicitly denied by security policy ({})",
                action_category,
                self.policy_path.display()
            );

            if self.policy.audit.log_all_decisions {
                tracing::error!("{}", reason);
            }

            return GateDecision::Block { reason };
        }

        // 2. Explicit allow check
        if self.policy.allowed_tool_categories.iter().any(|a| a.to_lowercase() == category) {
            if self.policy.audit.log_all_decisions {
                tracing::debug!("[GATE v2.0] Action category '{}' allowed by policy.", action_category);
            }
            return GateDecision::Proceed;
        }

        // 3. Default deny: if not explicitly allowed, block
        let reason = format!(
            "[GATE v2.0] Action category '{}' is not in the allowlist. \
             Blocked by default-deny policy. Add to 'allowed_tool_categories' in {} to permit.",
            action_category,
            self.policy_path.display()
        );

        if self.policy.audit.log_all_decisions {
            tracing::warn!("{}", reason);
        }

        GateDecision::Block { reason }
    }

    /// Get paths that must be invisible inside the sandbox.
    ///
    /// These are EXCLUDED from the Landlock allowlist. The default-deny
    /// policy of Landlock ensures they are completely inaccessible.
    pub fn invisible_paths(&self) -> &[String] {
        &self.policy.invisible_inside_sandbox
    }

    /// Get the resource limits from the policy.
    pub fn resource_limits(&self) -> &ResourceLimits {
        &self.policy.resource_limits
    }

    /// Get the full policy for inspection.
    pub fn policy(&self) -> &SecurityManifest {
        &self.policy
    }

    /// Standard path for the policy file.
    pub fn policy_path() -> Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join(".config")))
            .context("Could not find config directory")?;

        Ok(config_dir.join("sandbox").join("security_policy.yaml"))
    }

    /// Seed the default policy file to disk so the user can inspect/edit it.
    fn seed_default_policy(path: &std::path::Path) -> Result<()> {
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        // Embedded default policy (from src/config/security_policy.yaml)
        let default_yaml = include_str!("../config/security_policy.yaml");

        std::fs::write(path, default_yaml)
            .with_context(|| format!("Failed to seed default policy to {}", path.display()))?;

        tracing::info!("[GATE] Seeded default security policy to {}", path.display());
        Ok(())
    }

    /// Build an in-memory default policy (used when file doesn't exist yet).
    fn default_policy() -> SecurityManifest {
        SecurityManifest {
            version: "2.0".to_string(),
            invisible_inside_sandbox: vec![
                "~/.config/sandbox".to_string(),
                "~/.antigravity".to_string(),
                "~/.sandbox".to_string(),
                "~/.claude".to_string(),
                "~/.gemini".to_string(),
                "~/.ssh".to_string(),
                "~/.aws".to_string(),
                "**/.env".to_string(),
                "**/.env.local".to_string(),
                "**/.env.production".to_string(),
            ],
            allowed_tool_categories: vec![
                "file_read_workspace".to_string(),
                "file_write_workspace".to_string(),
                "process_stdio".to_string(),
                "filesystem_stat".to_string(),
                "wasm_execute".to_string(),
            ],
            denied_tool_categories: vec![
                "network_egress".to_string(),
                "dns_lookup".to_string(),
                "process_spawn_arbitrary".to_string(),
                "kernel_module_load".to_string(),
                "raw_socket".to_string(),
                "env_var_read_sensitive".to_string(),
                "symlink_follow_external".to_string(),
                "cgroup_escape".to_string(),
                "ptrace_attach".to_string(),
            ],
            resource_limits: ResourceLimits::default(),
            audit: AuditConfig {
                log_all_decisions: true,
                log_resource_violations: true,
                denied_category_severity: "Critical".to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_gate() -> PreExecutionGate {
        PreExecutionGate {
            policy: PreExecutionGate::default_policy(),
            policy_path: PathBuf::from("/test/security_policy.yaml"),
        }
    }

    #[test]
    fn test_denied_categories_are_blocked() {
        let gate = make_test_gate();

        let result = gate.validate("network_egress");
        assert!(matches!(result, GateDecision::Block { .. }));

        let result = gate.validate("dns_lookup");
        assert!(matches!(result, GateDecision::Block { .. }));

        let result = gate.validate("ptrace_attach");
        assert!(matches!(result, GateDecision::Block { .. }));

        let result = gate.validate("raw_socket");
        assert!(matches!(result, GateDecision::Block { .. }));
    }

    #[test]
    fn test_allowed_categories_proceed() {
        let gate = make_test_gate();

        let result = gate.validate("file_read_workspace");
        assert_eq!(result, GateDecision::Proceed);

        let result = gate.validate("file_write_workspace");
        assert_eq!(result, GateDecision::Proceed);

        let result = gate.validate("wasm_execute");
        assert_eq!(result, GateDecision::Proceed);
    }

    #[test]
    fn test_unknown_category_default_deny() {
        let gate = make_test_gate();

        // Categories not in either list are denied by default
        let result = gate.validate("some_unknown_action");
        assert!(matches!(result, GateDecision::Block { .. }));

        let result = gate.validate("hardware_access");
        assert!(matches!(result, GateDecision::Block { .. }));
    }

    #[test]
    fn test_case_insensitive_matching() {
        let gate = make_test_gate();

        // Should match despite case difference
        let result = gate.validate("NETWORK_EGRESS");
        assert!(matches!(result, GateDecision::Block { .. }));

        let result = gate.validate("FILE_READ_WORKSPACE");
        assert_eq!(result, GateDecision::Proceed);
    }

    #[test]
    fn test_default_resource_limits() {
        let gate = make_test_gate();
        let limits = gate.resource_limits();

        assert_eq!(limits.memory_mb, 512);
        assert_eq!(limits.cpu_percent, 25);
        assert_eq!(limits.pids_max, 20);
        assert_eq!(limits.max_execution_seconds, 30);
    }

    #[test]
    fn test_invisible_paths_present() {
        let gate = make_test_gate();
        let paths = gate.invisible_paths();

        assert!(paths.iter().any(|p| p.contains(".ssh")));
        assert!(paths.iter().any(|p| p.contains(".env")));
        assert!(paths.iter().any(|p| p.contains(".antigravity")));
    }

    #[test]
    fn test_policy_path_resolution() {
        // Just verify it doesn't panic and returns a valid path
        let path = PreExecutionGate::policy_path();
        assert!(path.is_ok());
        let p = path.unwrap();
        assert!(p.to_str().unwrap().contains("sandbox"));
        assert!(p.to_str().unwrap().contains("security_policy.yaml"));
    }
}
