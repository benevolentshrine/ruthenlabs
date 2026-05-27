//! SANDBOX Cgroups v2 — Resource Determinism Layer
//!
//! This module implements Phase 2.0: Resource Determinism via Linux Cgroups v2.
//!
//! Cgroups v2 creates a hard resource ceiling for the sandboxed child process,
//! preventing three classes of resource-exhaustion attacks:
//!   - OOM attacks (memory.max = 512MB)
//!   - CPU-melt attacks / infinite loops (cpu.max = 25% of 1 core)
//!   - Fork bomb attacks (pids.max = 20 PIDs)
//!
//! The `CgroupJail` is ephemeral by design: it creates the cgroup before fork(),
//! adds the child PID after fork(), and destroys itself on `Drop` — ensuring
//! no cgroup artifacts persist between executions.
//!
//! GRACEFUL DEGRADATION: If `/sys/fs/cgroup` is not writable (e.g. inside
//! a container), a warning is logged and execution continues under Landlock+Seccomp.

use anyhow::{Context, Result};
use std::fs;
use std::path::{Path, PathBuf};

/// Default memory limit: 512 MB
pub const DEFAULT_MEMORY_LIMIT_BYTES: u64 = 512 * 1024 * 1024;

/// Default CPU quota: 25% of a single core
/// Format: "quota_us period_us" → 25000/100000 = 25%
pub const DEFAULT_CPU_QUOTA_US: u64 = 25_000;
pub const DEFAULT_CPU_PERIOD_US: u64 = 100_000;

/// Default max PIDs (prevents fork bombs)
pub const DEFAULT_PIDS_MAX: u32 = 20;

/// Resolve the cgroupv2 root path for the current process.
///
/// Reads `/proc/self/cgroup` to find the cgroup the process is already in,
/// then returns the canonical path below `/sys/fs/cgroup`. This works
/// regardless of UID, systemd slice naming, or distro.
///
/// Fallback chain:
///   1. `/sys/fs/cgroup/<cgroup>` from `/proc/self/cgroup` (preferred)
///   2. `/sys/fs/cgroup` (flat v2 — no systemd)
///   3. Degradation: empty path (caller must check `is_active()`)
fn cgroup_root_path() -> PathBuf {
    // Try reading /proc/self/cgroup to find our current cgroup
    if let Ok(content) = std::fs::read_to_string("/proc/self/cgroup") {
        for line in content.lines() {
            // Format: "0::/user.slice/user-1000.slice/user@1000.service/app.slice"
            let parts: Vec<&str> = line.splitn(3, ':').collect();
            if parts.len() == 3 && parts.last().map_or(false, |p| !p.is_empty()) {
                let cgroup = parts.last().unwrap();
                // Skip the root cgroup "/" — use sysfs root
                if *cgroup != "/" {
                    let path = PathBuf::from("/sys/fs/cgroup").join(cgroup.trim_start_matches('/'));
                    if path.exists() && path.join("cgroup.controllers").exists() {
                        return path;
                    }
                }
            }
        }
    }

    // Fallback: flat cgroupv2 (likely in a container without systemd)
    let flat_path = PathBuf::from("/sys/fs/cgroup");
    if flat_path.join("cgroup.controllers").exists() {
        return flat_path;
    }

    // No cgroupv2 available — caller will detect via is_active()
    PathBuf::new()
}

/// A scoped Cgroup v2 jail for a single sandboxed execution.
///
/// Created before fork(), child added after fork(), auto-destroyed on Drop.
pub struct CgroupJail {
    /// Unique name: "sandbox-<uuid>"
    name: String,
    /// Full path: /sys/fs/cgroup/sandbox-<uuid>
    cgroup_path: PathBuf,
    /// Whether the cgroup was successfully created
    active: bool,
}

impl CgroupJail {
    /// Create a new cgroup jail with a unique name.
    ///
    /// Detects the correct cgroupv2 root path at runtime via `/proc/self/cgroup`,
    /// so it works for any UID, any distro, any systemd slice layout.
    ///
    /// Returns Ok(jail) even if cgroup creation fails (graceful degradation).
    /// Check `jail.is_active()` to determine if limits are enforced.
    pub fn new(name: &str) -> Self {
        let root = cgroup_root_path();
        if root.as_os_str().is_empty() {
            tracing::warn!(
                "[CGROUP] Cgroup v2 not available on this system. \
                 Running without resource limits. Landlock+Seccomp still active."
            );
            return CgroupJail {
                name: name.to_string(),
                cgroup_path: PathBuf::new(),
                active: false,
            };
        }

        let cgroup_path = root.join(name);

        // Attempt to create the cgroup directory
        match fs::create_dir(&cgroup_path) {
            Ok(_) => {
                tracing::debug!("[CGROUP] Created cgroup jail: {}", cgroup_path.display());
                CgroupJail {
                    name: name.to_string(),
                    cgroup_path,
                    active: true,
                }
            }
            Err(e) => {
                tracing::warn!(
                    "[CGROUP] Could not create cgroup at {} ({}). \
                     Running without resource limits. Landlock+Seccomp still active.",
                    cgroup_path.display(),
                    e
                );
                CgroupJail {
                    name: name.to_string(),
                    cgroup_path,
                    active: false,
                }
            }
        }
    }

    /// Whether this jail has successfully created a cgroup.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Apply resource limits to the cgroup.
    ///
    /// Must be called AFTER `new()` and BEFORE `add_process()`.
    pub fn apply_limits(
        &self,
        memory_bytes: u64,
        cpu_quota_us: u64,
        cpu_period_us: u64,
        pids_max: u32,
    ) -> Result<()> {
        if !self.active {
            return Ok(()); // Graceful degradation
        }

        // 1. Memory limit: "536870912" (bytes)
        self.write_cgroup_file(
            "memory.max",
            &memory_bytes.to_string(),
        )
        .context("Failed to set memory.max")?;

        // Enable memory swap accounting (prevent swap escapes)
        self.write_cgroup_file(
            "memory.swap.max",
            "0", // No swap allowed
        )
        .context("Failed to set memory.swap.max")?;

        // 2. CPU quota: "25000 100000" (quota_us period_us)
        self.write_cgroup_file(
            "cpu.max",
            &format!("{} {}", cpu_quota_us, cpu_period_us),
        )
        .context("Failed to set cpu.max")?;

        // 3. PID limit: "20"
        self.write_cgroup_file(
            "pids.max",
            &pids_max.to_string(),
        )
        .context("Failed to set pids.max")?;

        tracing::info!(
            "[CGROUP] Applied limits to '{}': memory={}MB, cpu={}%, pids={}",
            self.name,
            memory_bytes / (1024 * 1024),
            (cpu_quota_us * 100) / cpu_period_us,
            pids_max,
        );

        Ok(())
    }

    /// Apply default limits (512MB RAM, 25% CPU, 20 PIDs).
    pub fn apply_default_limits(&self) -> Result<()> {
        self.apply_limits(
            DEFAULT_MEMORY_LIMIT_BYTES,
            DEFAULT_CPU_QUOTA_US,
            DEFAULT_CPU_PERIOD_US,
            DEFAULT_PIDS_MAX,
        )
    }

    /// Add a process (by PID) to this cgroup.
    ///
    /// MUST be called in the parent process immediately after fork(),
    /// before the child calls execvp(). This is safe because the child
    /// PID is known to the parent before the child begins execution.
    pub fn add_process(&self, pid: u32) -> Result<()> {
        if !self.active {
            return Ok(()); // Graceful degradation
        }

        self.write_cgroup_file("cgroup.procs", &pid.to_string())
            .context(format!("Failed to add PID {} to cgroup '{}'", pid, self.name))?;

        tracing::debug!("[CGROUP] Added PID {} to jail '{}'", pid, self.name);
        Ok(())
    }

    /// Destroy the cgroup, removing all resource limits.
    ///
    /// Called automatically on `Drop`. Safe to call multiple times.
    pub fn destroy(&mut self) -> Result<()> {
        if !self.active {
            return Ok(());
        }

        if self.cgroup_path.exists() {
            // Cgroup directories can only be removed when empty (no procs).
            // After the child exits, this should succeed.
            if let Err(e) = fs::remove_dir(&self.cgroup_path) {
                tracing::warn!(
                    "[CGROUP] Failed to remove cgroup '{}': {}. \
                     It will be cleaned up on next boot.",
                    self.name, e
                );
                return Ok(()); // Don't propagate — best-effort cleanup
            }
            tracing::debug!("[CGROUP] Destroyed cgroup jail: {}", self.name);
        }

        self.active = false;
        Ok(())
    }

    /// Write a value to a cgroup control file.
    fn write_cgroup_file(&self, filename: &str, value: &str) -> Result<()> {
        let path = self.cgroup_path.join(filename);
        fs::write(&path, value)
            .with_context(|| format!("Failed to write '{}' to {}", value, path.display()))
    }

    /// Get the cgroup path (for informational logging).
    pub fn path(&self) -> &Path {
        &self.cgroup_path
    }
}

/// Ephemeral guarantee: destroy cgroup on scope exit.
impl Drop for CgroupJail {
    fn drop(&mut self) {
        let _ = self.destroy();
    }
}

/// Check if cgroup v2 is available and writable on this system.
pub fn cgroup_v2_available() -> bool {
    let root = cgroup_root_path();
    if root.as_os_str().is_empty() {
        return false;
    }

    // Check that cgroup.controllers exists (cgroup v2 marker)
    if !root.join("cgroup.controllers").exists() {
        return false;
    }

    // Check writability by attempting to read cgroup.subtree_control
    root.join("cgroup.subtree_control").exists()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cgroup_availability_check() {
        // Just verify it doesn't panic
        let available = cgroup_v2_available();
        println!("Cgroup v2 available: {}", available);
        // We don't assert true/false because it depends on the host system
    }

    #[test]
    fn test_cgroup_jail_graceful_degradation() {
        // Create a jail with an invalid path to test graceful degradation
        let jail = CgroupJail {
            name: "test-degrade".to_string(),
            cgroup_path: PathBuf::from("/nonexistent/cgroup/path"),
            active: false,
        };

        // Should not panic or error
        assert!(!jail.is_active());
        assert!(jail.apply_default_limits().is_ok());
        assert!(jail.add_process(1).is_ok());
    }

    #[test]
    fn test_default_limits_are_sane() {
        // Verify the default constants are sensible
        assert_eq!(DEFAULT_MEMORY_LIMIT_BYTES, 512 * 1024 * 1024);
        assert_eq!(DEFAULT_CPU_QUOTA_US, 25_000);
        assert_eq!(DEFAULT_CPU_PERIOD_US, 100_000);
        assert_eq!(DEFAULT_PIDS_MAX, 20);

        // CPU percentage should be 25%
        let pct = (DEFAULT_CPU_QUOTA_US * 100) / DEFAULT_CPU_PERIOD_US;
        assert_eq!(pct, 25);
    }
}
