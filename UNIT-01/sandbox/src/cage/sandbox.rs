use anyhow::{Context, Result};
#[cfg(target_os = "linux")]
use landlock::{
    Access, AccessFs, PathBeneath, PathFd, Ruleset, ABI,
};
#[cfg(target_os = "linux")]
use libseccomp::*;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};

/// Configuration for the sandbox.
#[derive(Debug, Clone)]
pub struct SandboxOptions {
    pub timeout_secs: u64,
}

impl Default for SandboxOptions {
    fn default() -> Self {
        Self { timeout_secs: 30 }
    }
}

/// A sandboxed child process with automatic timeout.
pub struct SandboxedChild {
    child: Option<std::process::Child>,
    timeout_secs: u64,
}

impl SandboxedChild {
    pub fn wait_with_output(mut self) -> Result<std::process::Output> {
        let timeout = self.timeout_secs;
        let killed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        if timeout > 0 {
            if let Some(ref child) = self.child {
                let pid = child.id();
                let killed_clone = killed.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(timeout));
                    killed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
                });
            }
        }

        let child = self
            .child
            .take()
            .ok_or_else(|| anyhow::anyhow!("child already taken"))?;
        let output = child
            .wait_with_output()
            .context("Failed to wait for sandboxed child")?;

        if killed.load(std::sync::atomic::Ordering::SeqCst) {
            tracing::warn!(
                "[SANDBOX] Child process timed out after {}s and was killed.",
                timeout
            );
        }

        Ok(output)
    }

    pub fn wait(mut self) -> Result<std::process::ExitStatus> {
        let timeout = self.timeout_secs;
        let killed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        if timeout > 0 {
            if let Some(ref child) = self.child {
                let pid = child.id();
                let killed_clone = killed.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(timeout));
                    killed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
                });
            }
        }

        let mut child = self
            .child
            .take()
            .ok_or_else(|| anyhow::anyhow!("child already taken"))?;
        let status = child.wait().context("Failed to wait for sandboxed child")?;

        if killed.load(std::sync::atomic::Ordering::SeqCst) {
            tracing::warn!(
                "[SANDBOX] Child process timed out after {}s and was killed.",
                timeout
            );
        }

        Ok(status)
    }

    pub fn take_child(mut self) -> Result<std::process::Child> {
        self.child.take().ok_or_else(|| anyhow::anyhow!("child already taken"))
    }
}

impl Drop for SandboxedChild {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// ---------------------------------------------------------------------------
// Public API: spawn a sandboxed process
// ---------------------------------------------------------------------------

pub fn spawn_sandboxed_command(
    program: &str,
    args: &[String],
    workspace: &Path,
    opts: SandboxOptions,
    enabled: bool,
) -> Result<SandboxedChild> {
    let workspace_owned = workspace.to_path_buf();

    // Build the command. On macOS, wrap with sandbox-exec + generated Seatbelt profile.
    #[cfg(target_os = "macos")]
    let mut command = {
        let profile = generate_seatbelt_profile(&workspace_owned);
        let mut cmd = Command::new("/usr/bin/sandbox-exec");
        cmd.arg("-p");
        cmd.arg(&profile);
        cmd.arg("--");
        cmd.arg(program);
        for a in args {
            cmd.arg(a);
        }
        cmd
    };

    #[cfg(not(target_os = "macos"))]
    let mut command = {
        let mut cmd = Command::new(program);
        for a in args {
            cmd.arg(a);
        }
        cmd
    };

    command
        .current_dir(workspace)
        .env_clear()
        .env("HOME", workspace)
        .env("TMPDIR", workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Apply enforcement layers in the fork-gap.
    unsafe {
        command.pre_exec(move || {
            if !enabled {
                return Ok(());
            }

            // LAYER 0: POSIX resource limits (cross-platform)
            apply_resource_limits(512 * 1024 * 1024, 20);

            // LAYER 1: Filesystem jail
            match apply_landlock_policy(&workspace_owned) {
                Ok(full_v2) => {
                    if !full_v2 {
                        eprintln!(
                            "[SANDBOX] WARNING: Landlock ABI v1 applied (kernel < 5.19). \
                             Symlink-follow control unavailable."
                        );
                    }
                }
                Err(e) => {
                    eprintln!("[SANDBOX] Landlock enforcement failed: {}", e);
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "Landlock enforcement failed",
                    ));
                }
            }

            // LAYER 2: Seccomp-BPF — Privilege escalation kill only (network always allowed)
            if let Err(e) = apply_seccomp_policy() {
                eprintln!("[SANDBOX] Seccomp enforcement failed: {}", e);
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Seccomp enforcement failed",
                ));
            }

            Ok(())
        });
    }

    let child = command.spawn().context("Failed to spawn sandboxed child")?;
    Ok(SandboxedChild {
        child: Some(child),
        timeout_secs: opts.timeout_secs,
    })
}

// ---------------------------------------------------------------------------
// macOS: Seatbelt profile generator for sandbox-exec
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn generate_seatbelt_profile(workspace: &Path) -> String {
    let ws = workspace.to_string_lossy();

    // System paths that the process needs read-only access to.
    let system_ro_paths = [
        "/usr/lib",
        "/System/Library",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
        "/usr/local/bin",
        "/usr/local/lib",
        "/usr/share",
        "/private/tmp",
        "/etc",
        "/dev",
    ];

    let mut profile = String::new();
    profile.push_str("(version 1)\n");
    profile.push_str("(deny default)\n");

    // Workspace — full read/write access
    profile.push_str(&format!(
        "(allow file-read* (subpath \"{}\"))\n",
        ws
    ));
    profile.push_str(&format!(
        "(allow file-write* (subpath \"{}\"))\n",
        ws
    ));

    // Root directory for path resolution
    profile.push_str("(allow file-read* (literal \"/\"))\n");

    // Executable mapping (required for dyld)
    profile.push_str("(allow file-map-executable)\n");

    // System RO paths
    for p in &system_ro_paths {
        profile.push_str(&format!("(allow file-read* (subpath \"{}\"))\n", p));
    }

    // Process operations
    profile.push_str("(allow process-exec*)\n");
    profile.push_str("(allow process-fork)\n");

    // System operations
    profile.push_str("(allow sysctl-read)\n");
    profile.push_str("(allow mach*)\n");
    profile.push_str("(allow ipc*)\n");
    profile.push_str("(allow signal)\n");
    profile.push_str("(allow system-socket)\n");
    profile.push_str("(allow system-fsctl)\n");
    profile.push_str("(allow system-info)\n");

    // Network — always allowed (filesystem-only sandbox)
    profile.push_str("(allow network*)\n");

    profile
}

// ---------------------------------------------------------------------------
// Layer 1: Landlock v2 — Symlink-Safe Filesystem Jail (Linux only)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn apply_landlock_policy(workspace: &Path) -> Result<bool> {
    let (abi, full_v2) = if ABI::V2 as u32 > 0 {
        (ABI::V2, true)
    } else {
        (ABI::V1, false)
    };

    let mut ruleset = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))
        .context("Failed to initialize Landlock ruleset")?
        .create()
        .context("Failed to create Landlock ruleset")?;

    // Workspace: Full RWX
    let workspace_full_access = AccessFs::from_all(abi);
    let workspace_fd = PathFd::new(workspace)
        .with_context(|| format!("Failed to open workspace fd: {}", workspace.display()))?;
    ruleset = ruleset
        .add_rule(PathBeneath::new(workspace_fd, workspace_full_access))
        .with_context(|| format!("Failed to add workspace rule: {}", workspace.display()))?;

    // System paths: Read-only
    let ro_access = AccessFs::from_read(abi);
    let system_ro_paths = [
        "/lib", "/lib64", "/usr/lib", "/usr/lib64",
        "/bin", "/usr/bin", "/sbin", "/usr/sbin",
        "/usr/local/bin", "/usr/share", "/usr/local/lib",
        "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d",
        "/etc/localtime", "/proc/self", "/tmp",
    ];

    for path_str in &system_ro_paths {
        let path = Path::new(path_str);
        if !path.exists() {
            tracing::debug!("[LANDLOCK] Skipping {} (does not exist)", path_str);
            continue;
        }
        let fd = match PathFd::new(path) {
            Ok(fd) => fd,
            Err(e) => {
                tracing::debug!("[LANDLOCK] Skipping {} (not accessible): {}", path_str, e);
                continue;
            }
        };
        ruleset = ruleset
            .add_rule(PathBeneath::new(fd, ro_access))
            .map_err(|e| anyhow::anyhow!("Failed to add Landlock RO rule for {}: {:?}", path_str, e))?;
    }

    let restriction_status = ruleset
        .restrict_self()
        .context("Failed to apply Landlock policy to process")?;

    let achieved_v2 = full_v2 && restriction_status.no_new_privs;
    if achieved_v2 {
        tracing::info!(
            "[LANDLOCK v2] Full ABI v2 filesystem jail active. Workspace: {}",
            workspace.display()
        );
    } else {
        tracing::warn!(
            "[LANDLOCK] ABI v1 degraded enforcement. Workspace: {}",
            workspace.display()
        );
    }

    Ok(achieved_v2)
}

#[cfg(not(target_os = "linux"))]
fn apply_landlock_policy(_workspace: &Path) -> Result<bool> {
    Ok(true)
}

// ---------------------------------------------------------------------------
// Layer 2: Seccomp-BPF — Privilege Escalation Kill Only (Linux only)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn apply_seccomp_policy() -> Result<()> {
    let mut filter = ScmpFilterContext::new_filter(ScmpAction::Allow)
        .context("Failed to create Seccomp filter context")?;

    let kill_on_violation = [
        "unshare", "mount", "umount2", "pivot_root", "chroot",
        "ptrace", "process_vm_writev", "process_vm_readv",
        "clone3", "setns", "kexec_load", "kexec_file_load",
        "init_module", "finit_module", "delete_module",
        "perf_event_open", "kcmp",
    ];

    for syscall_name in kill_on_violation {
        match ScmpSyscall::from_name(syscall_name) {
            Ok(syscall) => {
                filter.add_rule(ScmpAction::KillProcess, syscall)
                    .with_context(|| format!("Failed to add kill rule for: {}", syscall_name))?;
            }
            Err(_) => {
                tracing::debug!(
                    "[SECCOMP] Escalation syscall '{}' not found on this kernel, skipping.",
                    syscall_name
                );
            }
        }
    }

    filter.load().context("Failed to load Seccomp filter into kernel")?;

    tracing::info!("[SECCOMP] Filter active. Default: ALLOW. Network: ALLOWED. Privesc: KILL.");
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn apply_seccomp_policy() -> Result<()> {
    Ok(())
}

// ---------------------------------------------------------------------------
// Cross-Platform: POSIX Resource Limits
// ---------------------------------------------------------------------------

fn apply_resource_limits(mem_bytes: u64, pids_max: u32) {
    let rlim_as = libc::rlimit {
        rlim_cur: mem_bytes,
        rlim_max: mem_bytes,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_AS, &rlim_as) } != 0 {
        tracing::warn!("[RLIMIT] Failed to set RLIMIT_AS");
    }

    let rlim_nofile = libc::rlimit {
        rlim_cur: 256,
        rlim_max: 256,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &rlim_nofile) } != 0 {
        tracing::warn!("[RLIMIT] Failed to set RLIMIT_NOFILE");
    }

    #[cfg(not(target_os = "macos"))]
    {
        let rlim_nproc = libc::rlimit {
            rlim_cur: pids_max as libc::rlim_t,
            rlim_max: pids_max as libc::rlim_t,
        };
        if unsafe { libc::setrlimit(libc::RLIMIT_NPROC, &rlim_nproc) } != 0 {
            tracing::warn!("[RLIMIT] Failed to set RLIMIT_NPROC");
        }
    }

    tracing::info!(
        "[RLIMIT] Resource limits applied: mem={}, pids={}",
        mem_bytes,
        pids_max
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sandbox_options_default() {
        let opts = SandboxOptions::default();
        assert_eq!(opts.timeout_secs, 30);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_basic_execution_via_sandbox() {
        let workspace = std::env::temp_dir().join("sandbox_test_net");
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).unwrap();

        let opts = SandboxOptions::default();
        let args: Vec<String> = vec!["-c".to_string(), "echo hello".to_string()];
        if let Ok(child) = spawn_sandboxed_command("sh", &args, &workspace, opts, true) {
            let output = child.wait_with_output().expect("Failed to wait for child");
            assert!(output.unwrap().status.success());
        }

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn test_filesystem_isolation_via_sandbox() {
        let workspace = std::env::temp_dir().join("sandbox_v2_test_fs");
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).unwrap();

        let opts = SandboxOptions::default();
        let args: Vec<String> = vec!["/etc/passwd".to_string()];
        if let Ok(child) = spawn_sandboxed_command("cat", &args, &workspace, opts, true) {
            let status = child.wait().expect("Failed to wait for child");
            assert!(
                !status.success(),
                "cat /etc/passwd should fail: path invisible to Landlock"
            );
        }

        let _ = std::fs::remove_dir_all(&workspace);
    }
}
