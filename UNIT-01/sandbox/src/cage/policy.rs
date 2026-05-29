//! SANDBOX Security Policy — 5 security modes with absolute invariants
//!
//! Security Modes:
//! - HARD (🔴): Auto-block everything, always quarantine
//! - MID (🟠): Default — block network/spawn, prompt on file access
//! - EASY (🟡): Permissive — auto-allow reads, prompt on writes/network
//! - CUSTOM (⚙️): User-defined rules with TUI prompts
//! - AUDIT (🔵): Observe all — block nothing except invariants

use std::collections::HashSet;
use std::path::Path;

/// Security mode for cage operation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityMode {
    /// 🔴 HARD: Auto-block everything, always quarantine
    Hard,
    /// 🟠 MID: Default — block network/spawn, prompt on file access
    Mid,
    /// 🟡 EASY: Permissive — auto-allow reads, prompt on writes/network
    Easy,
    /// ⚙️ CUSTOM: User-defined rules with TUI prompts
    Custom,
    /// 🔵 AUDIT: Observe all — block nothing except absolute invariants
    Audit,
}

impl From<&str> for SecurityMode {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "hard" | "strict" => SecurityMode::Hard,
            "easy" | "permissive" => SecurityMode::Easy,
            "custom" => SecurityMode::Custom,
            "audit" => SecurityMode::Audit,
            _ => SecurityMode::Mid, // Default
        }
    }
}

impl std::fmt::Display for SecurityMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SecurityMode::Hard => write!(f, "🔴 HARD"),
            SecurityMode::Mid => write!(f, "🟠 MID"),
            SecurityMode::Easy => write!(f, "🟡 EASY"),
            SecurityMode::Custom => write!(f, "⚙️ CUSTOM"),
            SecurityMode::Audit => write!(f, "🔵 AUDIT"),
        }
    }
}

/// Policy decision
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyDecision {
    /// Automatically allow
    AutoAllow,
    /// Automatically block (no prompt)
    AutoBlock { reason: String },
    /// Prompt user for decision
    Prompt { reason: String },
}

/// Absolute invariants — NEVER promptable, always auto-block
///
/// These are the hard security boundaries that cannot be overridden
/// by any security mode, including CUSTOM.
pub struct AbsoluteInvariants;

impl AbsoluteInvariants {
    /// Sensitive path patterns that are NEVER allowed
    const SENSITIVE_PATHS: &[&str] = &[".ssh", ".gnupg", ".aws", ".config", ".netrc", "keystore"];

    /// Sensitive file patterns
    const SENSITIVE_FILES: &[&str] = &[
        ".env",
        ".env.local",
        ".env.production",
        "secrets",
        "secrets.yml",
        "secrets.yaml",
        "credentials",
        "credentials.json",
        "id_rsa",
        "id_ed25519",
        "id_ecdsa",
        ".pgpass",
        ".my.cnf",
    ];

    /// Critical system events that are NEVER allowed
    const CRITICAL_EVENTS: &[&str] = &[
        "raw_syscall",
        "kernel_module_load",
        "kexec",
        "ptrace_attach",
        "process_vm_writev",
    ];

    /// Check if a path is sensitive and must be blocked
    pub fn is_sensitive_path(path: &Path) -> bool {
        let path_str = path.to_string_lossy().to_lowercase();

        // Check sensitive path patterns
        for pattern in Self::SENSITIVE_PATHS {
            if path_str.contains(pattern) {
                return true;
            }
        }

        // Check sensitive file names
        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
            let filename_lower = filename.to_lowercase();
            for pattern in Self::SENSITIVE_FILES {
                if filename_lower.contains(pattern) {
                    return true;
                }
            }
        }

        false
    }

    /// Check if an event is critical and must be blocked
    pub fn is_critical_event(event: &str) -> bool {
        Self::CRITICAL_EVENTS.contains(&event)
    }
}

/// Security policy with mode-specific rules
pub struct SecurityPolicy {
    pub mode: SecurityMode,
    /// Paths explicitly allowed by user (CUSTOM mode)
    pub allowed_paths: HashSet<String>,
    /// Paths explicitly denied by user (CUSTOM mode)
    pub denied_paths: HashSet<String>,
    /// File types explicitly allowed (CUSTOM mode)
    pub allowed_types: HashSet<String>,
    /// File types explicitly denied (CUSTOM mode)
    pub denied_types: HashSet<String>,
}

impl SecurityPolicy {
    /// Create a new policy with the given mode
    pub fn new(mode: SecurityMode) -> Self {
        Self {
            mode,
            allowed_paths: HashSet::new(),
            denied_paths: HashSet::new(),
            allowed_types: HashSet::new(),
            denied_types: HashSet::new(),
        }
    }

    /// Evaluate file read access
    pub fn evaluate_file_read(&self, path: &Path, outside_workspace: bool) -> PolicyDecision {
        // First check absolute invariants (applies to ALL modes including AUDIT)
        if AbsoluteInvariants::is_sensitive_path(path) {
            return PolicyDecision::AutoBlock {
                reason: format!(
                    "Access to sensitive path blocked by absolute invariant: {}",
                    path.display()
                ),
            };
        }

        // CUSTOM mode: check user rules
        if self.mode == SecurityMode::Custom {
            let path_str = path.to_string_lossy().to_string();
            if self.denied_paths.contains(&path_str) {
                return PolicyDecision::AutoBlock {
                    reason: format!("Path explicitly denied by custom rules: {}", path.display()),
                };
            }
            if self.allowed_paths.contains(&path_str) {
                return PolicyDecision::AutoAllow;
            }
        }

        // Mode-specific evaluation
        match self.mode {
            SecurityMode::Hard => PolicyDecision::AutoBlock {
                reason: format!("File read blocked in HARD mode: {}", path.display()),
            },
            SecurityMode::Mid => {
                if outside_workspace {
                    PolicyDecision::Prompt {
                        reason: format!("File read outside workspace: {}", path.display()),
                    }
                } else {
                    PolicyDecision::AutoAllow
                }
            }
            SecurityMode::Easy => PolicyDecision::AutoAllow,
            SecurityMode::Custom => PolicyDecision::Prompt {
                reason: format!("File read requires user decision: {}", path.display()),
            },
            SecurityMode::Audit => PolicyDecision::AutoAllow, // AUDIT: observe only
        }
    }

    /// Evaluate file write access
    pub fn evaluate_file_write(&self, path: &Path, outside_workspace: bool) -> PolicyDecision {
        // First check absolute invariants (applies to ALL modes including AUDIT)
        if AbsoluteInvariants::is_sensitive_path(path) {
            return PolicyDecision::AutoBlock {
                reason: format!(
                    "Write to sensitive path blocked by absolute invariant: {}",
                    path.display()
                ),
            };
        }

        // CUSTOM mode: check user rules
        if self.mode == SecurityMode::Custom {
            let path_str = path.to_string_lossy().to_string();
            if self.denied_paths.contains(&path_str) {
                return PolicyDecision::AutoBlock {
                    reason: format!("Path explicitly denied by custom rules: {}", path.display()),
                };
            }
            if self.allowed_paths.contains(&path_str) {
                return PolicyDecision::AutoAllow;
            }
        }

        // Mode-specific evaluation
        match self.mode {
            SecurityMode::Hard => PolicyDecision::AutoBlock {
                reason: format!("File write blocked in HARD mode: {}", path.display()),
            },
            SecurityMode::Mid => {
                if outside_workspace {
                    PolicyDecision::Prompt {
                        reason: format!("File write outside workspace: {}", path.display()),
                    }
                } else {
                    PolicyDecision::AutoAllow
                }
            }
            SecurityMode::Easy => {
                if outside_workspace {
                    PolicyDecision::Prompt {
                        reason: format!("File write outside home directory: {}", path.display()),
                    }
                } else {
                    PolicyDecision::AutoAllow
                }
            }
            SecurityMode::Custom => PolicyDecision::Prompt {
                reason: format!("File write requires user decision: {}", path.display()),
            },
            SecurityMode::Audit => PolicyDecision::AutoAllow, // AUDIT: observe only
        }
    }

    /// Evaluate network access
    pub fn evaluate_network(&self, _destination: Option<&str>) -> PolicyDecision {
        // Network is always blocked in HARD mode
        match self.mode {
            SecurityMode::Hard => PolicyDecision::AutoBlock {
                reason: "Network access blocked in HARD mode".to_string(),
            },
            SecurityMode::Mid => PolicyDecision::AutoBlock {
                reason: "Network access blocked in MID mode".to_string(),
            },
            SecurityMode::Easy => PolicyDecision::Prompt {
                reason: "Network access requires user approval".to_string(),
            },
            SecurityMode::Custom => PolicyDecision::Prompt {
                reason: "Network access requires user decision".to_string(),
            },
            SecurityMode::Audit => PolicyDecision::AutoAllow, // AUDIT: observe only, sinkhole captures
        }
    }

    /// Evaluate process execution
    pub fn evaluate_process_spawn(&self) -> PolicyDecision {
        // Process spawn is always blocked in HARD and MID modes
        match self.mode {
            SecurityMode::Hard | SecurityMode::Mid => PolicyDecision::AutoBlock {
                reason: "Process execution blocked by cage policy".to_string(),
            },
            SecurityMode::Easy | SecurityMode::Custom => PolicyDecision::Prompt {
                reason: "Process execution requires user approval".to_string(),
            },
            SecurityMode::Audit => PolicyDecision::AutoAllow, // AUDIT: observe only
        }
    }

    /// Evaluate environment variable access
    pub fn evaluate_env_access(&self, var_name: &str) -> PolicyDecision {
        // Sensitive env vars are always blocked (applies to ALL modes including AUDIT)
        let sensitive_vars = [
            "SSH_PRIVATE_KEY",
            "AWS_SECRET_ACCESS_KEY",
            "AWS_ACCESS_KEY_ID",
            "GITHUB_TOKEN",
            "API_KEY",
            "SECRET",
            "PASSWORD",
            "PASSWD",
        ];

        if sensitive_vars.iter().any(|s| var_name.contains(s)) {
            return PolicyDecision::AutoBlock {
                reason: format!(
                    "Access to sensitive environment variable blocked: {}",
                    var_name
                ),
            };
        }

        match self.mode {
            SecurityMode::Hard => PolicyDecision::AutoBlock {
                reason: format!("Environment access blocked in HARD mode: {}", var_name),
            },
            SecurityMode::Mid => PolicyDecision::Prompt {
                reason: format!("Environment variable access: {}", var_name),
            },
            SecurityMode::Easy | SecurityMode::Custom => PolicyDecision::AutoAllow,
            SecurityMode::Audit => PolicyDecision::AutoAllow, // AUDIT: observe only
        }
    }

    /// Evaluate extension mismatch
    pub fn evaluate_extension_mismatch(
        &self,
        claimed_ext: &str,
        real_type: &str,
    ) -> PolicyDecision {
        match self.mode {
            SecurityMode::Hard => PolicyDecision::AutoBlock {
                reason: format!(
                    "CRITICAL: Extension mismatch detected in HARD mode. Claimed: {}, Real: {}",
                    claimed_ext, real_type
                ),
            },
            SecurityMode::Audit => PolicyDecision::AutoAllow, // AUDIT: observe only
            _ => PolicyDecision::Prompt {
                reason: format!(
                    "WARNING: Extension mismatch detected. Claimed: {}, Real: {}",
                    claimed_ext, real_type
                ),
            },
        }
    }

    /// Evaluate unknown file type
    pub fn evaluate_unknown_file(&self, filename: &str) -> PolicyDecision {
        match self.mode {
            SecurityMode::Hard => PolicyDecision::AutoBlock {
                reason: format!("Unknown file type blocked in HARD mode: {}", filename),
            },
            SecurityMode::Audit => PolicyDecision::AutoAllow, // AUDIT: observe only
            _ => PolicyDecision::Prompt {
                reason: format!("Unknown file type: {}", filename),
            },
        }
    }
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self::new(SecurityMode::Mid)
    }
}

// ---------------------------------------------------------------------------
// Pre-Execution Source Scanner
// ---------------------------------------------------------------------------

/// Pattern descriptor for the source scanner
struct ScanPattern {
    pattern: &'static str,
    reason: &'static str,
}

impl SecurityPolicy {
    /// Scan script source text for dangerous patterns before execution.
    ///
    /// This is the **pre-execution gate** — it runs entirely in Rust before any
    /// child process is forked. Even if Landlock degrades, this layer catches
    /// dangerous code at the text level.
    ///
    /// Returns `Some(reason)` if execution must be blocked, `None` if clean.
    pub fn scan_source(&self, source: &str) -> Option<String> {
        match self.mode {
            SecurityMode::Hard => Self::scan_hard(source),
            SecurityMode::Mid => Self::scan_mid(source),
            // EASY and AUDIT observe only — no pre-execution block
            SecurityMode::Easy | SecurityMode::Custom | SecurityMode::Audit => None,
        }
    }

    /// HARD mode: block all dangerous patterns — zero tolerance
    fn scan_hard(source: &str) -> Option<String> {
        // Forbidden path patterns: any access to system directories
        const FORBIDDEN_PATH_PREFIXES: &[(&str, &str)] = &[
            ("/etc/", "forbidden path read: /etc/"),
            ("/proc/", "forbidden path read: /proc/"),
            ("/sys/", "forbidden path read: /sys/"),
            ("/root/", "forbidden path read: /root/"),
            ("/home/", "forbidden path read: /home/"),
        ];

        for (prefix, reason) in FORBIDDEN_PATH_PREFIXES {
            if source.contains(prefix) {
                return Some(format!("Pre-execution gate blocked — {}", reason));
            }
        }

        // Forbidden import/module patterns
        const HARD_BLOCKED_PATTERNS: &[ScanPattern] = &[
            ScanPattern {
                pattern: "import os",
                reason: "forbidden import: os module (filesystem/process access)",
            },
            ScanPattern {
                pattern: "import shutil",
                reason: "forbidden import: shutil module (destructive file ops)",
            },
            ScanPattern {
                pattern: "import subprocess",
                reason: "forbidden import: subprocess module (process spawn)",
            },
            ScanPattern {
                pattern: "import socket",
                reason: "forbidden import: socket module (network access)",
            },
            ScanPattern {
                pattern: "import requests",
                reason: "forbidden import: requests module (HTTP network)",
            },
            ScanPattern {
                pattern: "import urllib",
                reason: "forbidden import: urllib module (HTTP network)",
            },
            ScanPattern {
                pattern: "import httplib",
                reason: "forbidden import: httplib module (HTTP network)",
            },
            ScanPattern {
                pattern: "import http.client",
                reason: "forbidden import: http.client module (HTTP network)",
            },
            ScanPattern {
                pattern: "requests.",
                reason: "forbidden call: requests (HTTP network)",
            },
            ScanPattern {
                pattern: "urllib.",
                reason: "forbidden call: urllib (HTTP network)",
            },
            ScanPattern {
                pattern: "eval(",
                reason: "forbidden call: eval() (arbitrary code execution)",
            },
            ScanPattern {
                pattern: "exec(",
                reason: "forbidden call: exec() (arbitrary code execution)",
            },
            ScanPattern {
                pattern: "__import__(",
                reason: "forbidden call: __import__() (dynamic module load)",
            },
            ScanPattern {
                pattern: "os.system(",
                reason: "forbidden syscall: os.system (process spawn)",
            },
            ScanPattern {
                pattern: "os.popen(",
                reason: "forbidden syscall: os.popen (process spawn)",
            },
            ScanPattern {
                pattern: "os.remove(",
                reason: "forbidden syscall: os.remove (file deletion)",
            },
            ScanPattern {
                pattern: "os.unlink(",
                reason: "forbidden syscall: os.unlink (file deletion)",
            },
            ScanPattern {
                pattern: "os.rmdir(",
                reason: "forbidden syscall: os.rmdir (directory deletion)",
            },
            ScanPattern {
                pattern: "shutil.rmtree(",
                reason: "forbidden syscall: shutil.rmtree (recursive deletion)",
            },
            ScanPattern {
                pattern: "shutil.move(",
                reason: "forbidden syscall: shutil.move (file move)",
            },
            ScanPattern {
                pattern: "subprocess.run(",
                reason: "forbidden syscall: subprocess.run (process spawn)",
            },
            ScanPattern {
                pattern: "subprocess.Popen(",
                reason: "forbidden syscall: subprocess.Popen (process spawn)",
            },
            ScanPattern {
                pattern: "subprocess.call(",
                reason: "forbidden syscall: subprocess.call (process spawn)",
            },
            ScanPattern {
                pattern: "socket.socket(",
                reason: "forbidden call: socket.socket (raw network socket)",
            },
            ScanPattern {
                pattern: "socket.connect(",
                reason: "forbidden call: socket.connect (network connection)",
            },
        ];

        for pat in HARD_BLOCKED_PATTERNS {
            if source.contains(pat.pattern) {
                return Some(format!("Pre-execution gate blocked — {}", pat.reason));
            }
        }

        None
    }

    /// MID mode: block network, spawn, and out-of-workspace paths
    fn scan_mid(source: &str) -> Option<String> {
        // System path reads are forbidden in MID mode
        const MID_FORBIDDEN_PATHS: &[(&str, &str)] = &[
            ("/etc/", "forbidden path read: /etc/"),
            ("/proc/", "forbidden path read: /proc/"),
            ("/sys/", "forbidden path read: /sys/"),
            ("/root/", "forbidden path read: /root/"),
        ];

        for (prefix, reason) in MID_FORBIDDEN_PATHS {
            if source.contains(prefix) {
                return Some(format!("Pre-execution gate blocked — {}", reason));
            }
        }

        // Network access is always blocked in MID mode
        const MID_NETWORK_PATTERNS: &[ScanPattern] = &[
            ScanPattern {
                pattern: "import socket",
                reason: "forbidden import: socket module (network access)",
            },
            ScanPattern {
                pattern: "import requests",
                reason: "forbidden import: requests module (HTTP network)",
            },
            ScanPattern {
                pattern: "import urllib",
                reason: "forbidden import: urllib module (HTTP network)",
            },
            ScanPattern {
                pattern: "import httplib",
                reason: "forbidden import: httplib module (HTTP network)",
            },
            ScanPattern {
                pattern: "import http.client",
                reason: "forbidden import: http.client module (HTTP network)",
            },
            ScanPattern {
                pattern: "requests.",
                reason: "forbidden call: requests (HTTP network)",
            },
            ScanPattern {
                pattern: "urllib.",
                reason: "forbidden call: urllib (HTTP network)",
            },
            ScanPattern {
                pattern: "socket.socket(",
                reason: "forbidden call: socket.socket (raw network socket)",
            },
            ScanPattern {
                pattern: "socket.connect(",
                reason: "forbidden call: socket.connect (network connection)",
            },
        ];

        for pat in MID_NETWORK_PATTERNS {
            if source.contains(pat.pattern) {
                return Some(format!("Pre-execution gate blocked — {}", pat.reason));
            }
        }

        // Process spawning is blocked in MID mode
        const MID_SPAWN_PATTERNS: &[ScanPattern] = &[
            ScanPattern {
                pattern: "subprocess.run(",
                reason: "forbidden syscall: subprocess.run (process spawn)",
            },
            ScanPattern {
                pattern: "subprocess.Popen(",
                reason: "forbidden syscall: subprocess.Popen (process spawn)",
            },
            ScanPattern {
                pattern: "subprocess.call(",
                reason: "forbidden syscall: subprocess.call (process spawn)",
            },
            ScanPattern {
                pattern: "os.system(",
                reason: "forbidden syscall: os.system (process spawn)",
            },
            ScanPattern {
                pattern: "os.popen(",
                reason: "forbidden syscall: os.popen (process spawn)",
            },
            // Env var access blocked in MID mode
            ScanPattern {
                pattern: "os.environ",
                reason: "forbidden call: os.environ (environment variable access)",
            },
            ScanPattern {
                pattern: "os.getenv(",
                reason: "forbidden call: os.getenv (environment variable access)",
            },
            // Destructive file ops blocked in MID mode
            ScanPattern {
                pattern: "os.remove(",
                reason: "forbidden syscall: os.remove (file deletion)",
            },
            ScanPattern {
                pattern: "os.unlink(",
                reason: "forbidden syscall: os.unlink (file deletion)",
            },
            ScanPattern {
                pattern: "os.rmdir(",
                reason: "forbidden syscall: os.rmdir (directory deletion)",
            },
            ScanPattern {
                pattern: "shutil.rmtree(",
                reason: "forbidden syscall: shutil.rmtree (recursive deletion)",
            },
            ScanPattern {
                pattern: "shutil.move(",
                reason: "forbidden syscall: shutil.move (file move)",
            },
        ];

        for pat in MID_SPAWN_PATTERNS {
            if source.contains(pat.pattern) {
                return Some(format!("Pre-execution gate blocked — {}", pat.reason));
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mode_from_str() {
        assert_eq!(SecurityMode::from("hard"), SecurityMode::Hard);
        assert_eq!(SecurityMode::from("HARD"), SecurityMode::Hard);
        assert_eq!(SecurityMode::from("strict"), SecurityMode::Hard);
        assert_eq!(SecurityMode::from("mid"), SecurityMode::Mid);
        assert_eq!(SecurityMode::from("MID"), SecurityMode::Mid);
        assert_eq!(SecurityMode::from("easy"), SecurityMode::Easy);
        assert_eq!(SecurityMode::from("permissive"), SecurityMode::Easy);
        assert_eq!(SecurityMode::from("custom"), SecurityMode::Custom);
        assert_eq!(SecurityMode::from("audit"), SecurityMode::Audit);
        assert_eq!(SecurityMode::from("unknown"), SecurityMode::Mid); // Default
    }

    #[test]
    fn test_absolute_invariants_sensitive_paths() {
        assert!(AbsoluteInvariants::is_sensitive_path(Path::new(
            "/home/user/.ssh/id_rsa"
        )));
        assert!(AbsoluteInvariants::is_sensitive_path(Path::new(
            "/app/.env"
        )));
        assert!(AbsoluteInvariants::is_sensitive_path(Path::new(
            "/home/user/.aws/credentials"
        )));
        assert!(!AbsoluteInvariants::is_sensitive_path(Path::new(
            "/tmp/test.txt"
        )));
    }

    #[test]
    fn test_hard_mode_blocks_everything() {
        let policy = SecurityPolicy::new(SecurityMode::Hard);

        let result = policy.evaluate_file_read(Path::new("/tmp/test.txt"), false);
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));

        let result = policy.evaluate_file_write(Path::new("/tmp/test.txt"), false);
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));

        let result = policy.evaluate_network(None);
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));

        let result = policy.evaluate_process_spawn();
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));
    }

    #[test]
    fn test_mid_mode_blocks_network_and_spawn() {
        let policy = SecurityPolicy::new(SecurityMode::Mid);

        let result = policy.evaluate_network(None);
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));

        let result = policy.evaluate_process_spawn();
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));
    }

    #[test]
    fn test_mid_mode_prompts_outside_workspace() {
        let policy = SecurityPolicy::new(SecurityMode::Mid);

        let result = policy.evaluate_file_read(Path::new("/etc/passwd"), true);
        assert!(matches!(result, PolicyDecision::Prompt { .. }));

        let result = policy.evaluate_file_write(Path::new("/etc/passwd"), true);
        assert!(matches!(result, PolicyDecision::Prompt { .. }));
    }

    #[test]
    fn test_easy_mode_allows_reads() {
        let policy = SecurityPolicy::new(SecurityMode::Easy);

        let result = policy.evaluate_file_read(Path::new("/etc/passwd"), true);
        assert!(matches!(result, PolicyDecision::AutoAllow));
    }

    #[test]
    fn test_sensitive_env_vars_blocked() {
        let policy = SecurityPolicy::new(SecurityMode::Easy);

        let result = policy.evaluate_env_access("AWS_SECRET_ACCESS_KEY");
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));

        let result = policy.evaluate_env_access("GITHUB_TOKEN");
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));
    }

    #[test]
    fn test_extension_mismatch_hard_mode() {
        let policy = SecurityPolicy::new(SecurityMode::Hard);

        let result = policy.evaluate_extension_mismatch("txt", "zip");
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));
    }

    #[test]
    fn test_unknown_file_hard_mode() {
        let policy = SecurityPolicy::new(SecurityMode::Hard);

        let result = policy.evaluate_unknown_file("mystery.xyz");
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));
    }

    #[test]
    fn test_audit_mode_allows_all() {
        let policy = SecurityPolicy::new(SecurityMode::Audit);

        // AUDIT mode should allow file reads
        let result = policy.evaluate_file_read(Path::new("/etc/passwd"), true);
        assert!(matches!(result, PolicyDecision::AutoAllow));

        // AUDIT mode should allow file writes
        let result = policy.evaluate_file_write(Path::new("/tmp/test.txt"), true);
        assert!(matches!(result, PolicyDecision::AutoAllow));

        // AUDIT mode should allow network
        let result = policy.evaluate_network(Some("example.com"));
        assert!(matches!(result, PolicyDecision::AutoAllow));

        // AUDIT mode should allow process spawn
        let result = policy.evaluate_process_spawn();
        assert!(matches!(result, PolicyDecision::AutoAllow));

        // AUDIT mode should allow env access
        let result = policy.evaluate_env_access("HOME");
        assert!(matches!(result, PolicyDecision::AutoAllow));
    }

    #[test]
    fn test_audit_mode_respects_invariants() {
        let policy = SecurityPolicy::new(SecurityMode::Audit);

        // Even AUDIT mode should block sensitive paths
        let result = policy.evaluate_file_read(Path::new("/home/user/.ssh/id_rsa"), false);
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));

        // Even AUDIT mode should block sensitive env vars
        let result = policy.evaluate_env_access("AWS_SECRET_ACCESS_KEY");
        assert!(matches!(result, PolicyDecision::AutoBlock { .. }));
    }
}
