use anyhow::{Context, Result};
#[cfg(target_os = "linux")]
use landlock::{
    Access, AccessFs, PathBeneath, PathFd, Ruleset, ABI,
};
#[cfg(target_os = "linux")]
use libseccomp::*;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Default set of commands that are excluded from sandbox execution.
/// These are kernel-sensitive tools that fundamentally cannot work inside
/// the kernel sandbox (Seccomp blocks their required syscalls).
pub const DEFAULT_EXCLUDED_COMMANDS: &[&str] = &[
    "docker", "docker-compose", "podman", "nerdctl", "buildah",
    "sudo", "su", "doas", "pkexec",
    "nsenter", "unshare",
    "mount", "umount",
    "modprobe", "insmod", "rmmod", "modinfo",
    "systemctl", "systemd", "journalctl",
    "flatpak", "snap", "apptainer", "singularity",
    "sandbox",
];

/// Configuration for the sandbox.
#[derive(Debug, Clone)]
pub struct SandboxOptions {
    pub timeout_secs: u64,
    /// Block all outbound network access (default: true).
    pub deny_network: bool,
    /// Local egress proxy port for domain allowlist enforcement.
    pub proxy_port: Option<u16>,
    /// Commands excluded from sandbox execution (matched against basename).
    pub excluded_commands: Vec<String>,
    /// Additional paths where writes are allowed (outside workspace).
    /// On macOS, enforced via Seatbelt allow rules.
    /// On Linux, added to Landlock with full RWX.
    pub allow_write_paths: Vec<PathBuf>,
    /// Paths where writes are denied (overrides allow, including workspace subpaths).
    /// macOS: explicit Seatbelt deny rules (works for subpaths).
    /// Linux: best-effort — paths outside the Landlock allowlist are already denied;
    /// subpaths of the workspace cannot be selectively denied with Landlock.
    pub deny_write_paths: Vec<PathBuf>,
    /// Paths where reads are denied (credential/location scoping).
    /// macOS: explicit Seatbelt deny rules.
    /// Linux: best-effort (paths not in Landlock allowlist are already denied).
    pub deny_read_paths: Vec<PathBuf>,
}

impl Default for SandboxOptions {
    fn default() -> Self {
        Self {
            timeout_secs: 30,
            deny_network: true,
            proxy_port: None,
            excluded_commands: DEFAULT_EXCLUDED_COMMANDS.iter().map(|s| s.to_string()).collect(),
            allow_write_paths: vec![],
            deny_write_paths: vec![],
            deny_read_paths: vec![],
        }
    }
}

/// A sandboxed child process with automatic timeout and temp dir cleanup.
#[derive(Debug)]
pub struct SandboxedChild {
    child: Option<std::process::Child>,
    timeout_secs: u64,
    /// Isolated temp directory for this process (cleaned up on Drop).
    temp_dir: Option<PathBuf>,
}

/// Guard that keeps a temp directory alive and cleans it up on Drop.
/// Returned by `SandboxedChild::take_child()` to allow streaming use.
pub struct TempDirGuard {
    path: Option<PathBuf>,
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        if let Some(ref path) = self.path {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

impl SandboxedChild {
    fn cleanup_temp_dir(&mut self) {
        if let Some(ref path) = self.temp_dir.take() {
            let _ = std::fs::remove_dir_all(path);
        }
    }

    pub fn wait_with_output(mut self) -> Result<std::process::Output> {
        let timeout = self.timeout_secs;
        let killed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        if timeout > 0 {
            if let Some(ref child) = self.child {
                let pid = child.id();
                let killed_clone = killed.clone();
                let finished_clone = finished.clone();
                std::thread::spawn(move || {
                    let sleep_interval = std::time::Duration::from_millis(100);
                    let mut elapsed = std::time::Duration::from_secs(0);
                    let target = std::time::Duration::from_secs(timeout);
                    while elapsed < target {
                        if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                            return;
                        }
                        std::thread::sleep(sleep_interval);
                        elapsed += sleep_interval;
                    }
                    if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                        return;
                    }
                    killed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                    
                    let mut sigkill_elapsed = std::time::Duration::from_secs(0);
                    let sigkill_target = std::time::Duration::from_secs(2);
                    while sigkill_elapsed < sigkill_target {
                        if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                            return;
                        }
                        std::thread::sleep(sleep_interval);
                        sigkill_elapsed += sleep_interval;
                    }
                    if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                        return;
                    }
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

        finished.store(true, std::sync::atomic::Ordering::SeqCst);

        if killed.load(std::sync::atomic::Ordering::SeqCst) {
            tracing::warn!(
                "[SANDBOX] Child process timed out after {}s and was killed.",
                timeout
            );
        }

        self.cleanup_temp_dir();
        Ok(output)
    }

    pub fn wait(mut self) -> Result<std::process::ExitStatus> {
        let timeout = self.timeout_secs;
        let killed = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let finished = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        if timeout > 0 {
            if let Some(ref child) = self.child {
                let pid = child.id();
                let killed_clone = killed.clone();
                let finished_clone = finished.clone();
                std::thread::spawn(move || {
                    let sleep_interval = std::time::Duration::from_millis(100);
                    let mut elapsed = std::time::Duration::from_secs(0);
                    let target = std::time::Duration::from_secs(timeout);
                    while elapsed < target {
                        if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                            return;
                        }
                        std::thread::sleep(sleep_interval);
                        elapsed += sleep_interval;
                    }
                    if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                        return;
                    }
                    killed_clone.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
                    
                    let mut sigkill_elapsed = std::time::Duration::from_secs(0);
                    let sigkill_target = std::time::Duration::from_secs(2);
                    while sigkill_elapsed < sigkill_target {
                        if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                            return;
                        }
                        std::thread::sleep(sleep_interval);
                        sigkill_elapsed += sleep_interval;
                    }
                    if finished_clone.load(std::sync::atomic::Ordering::SeqCst) {
                        return;
                    }
                    let _ = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
                });
            }
        }

        let mut child = self
            .child
            .take()
            .ok_or_else(|| anyhow::anyhow!("child already taken"))?;
        let status = child.wait().context("Failed to wait for sandboxed child")?;

        finished.store(true, std::sync::atomic::Ordering::SeqCst);

        if killed.load(std::sync::atomic::Ordering::SeqCst) {
            tracing::warn!(
                "[SANDBOX] Child process timed out after {}s and was killed.",
                timeout
            );
        }

        self.cleanup_temp_dir();
        Ok(status)
    }

    /// Get a reference to the isolated temp directory path.
    pub fn temp_dir(&self) -> Option<&PathBuf> {
        self.temp_dir.as_ref()
    }

    /// Take ownership of the child process for streaming use.
    /// The temp dir is handed off to a `TempDirGuard` which cleans up on Drop.
    pub fn take_child(mut self) -> Result<(std::process::Child, TempDirGuard)> {
        let child = self.child.take().ok_or_else(|| anyhow::anyhow!("child already taken"))?;
        let guard = TempDirGuard { path: self.temp_dir.take() };
        Ok((child, guard))
    }
}

impl Drop for SandboxedChild {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.cleanup_temp_dir();
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
    let workspace_owned = workspace.canonicalize().unwrap_or_else(|_| workspace.to_path_buf());
    let deny_network = opts.deny_network;
    let home_dir = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());

    // Check excluded commands (basename match)
    let prog_basename = Path::new(program)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(program);
    if opts.excluded_commands.iter().any(|e| e == prog_basename) {
        anyhow::bail!(
            "Command '{}' is excluded from sandbox execution. \
             This tool requires kernel features blocked by the sandbox \
             (namespaces, mounts, privileged syscalls). \
             Directive: Ask the user to install dependencies outside the sandbox, \
             or request 'Root' mode.",
            prog_basename
        );
    }

    // Create isolated temp directory under workspace (already RW in sandbox policy)
    let temp_dir = workspace_owned.join(format!(".unit01-tmp-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_dir)
        .with_context(|| format!("Failed to create isolated temp dir: {}", temp_dir.display()))?;

    // Build the command. On macOS, wrap with sandbox-exec + generated Seatbelt profile.
    #[cfg(target_os = "macos")]
    let mut command = {
        let profile = generate_seatbelt_profile(
            &workspace_owned, &home_dir, &temp_dir, deny_network,
            &opts.allow_write_paths, &opts.deny_write_paths, &opts.deny_read_paths,
        );
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

    let proxy_port = opts.proxy_port;
    command
        .current_dir(&workspace_owned)
        .env("HOME", &workspace_owned)
        .env("TMPDIR", &temp_dir);

    if let Some(port) = proxy_port {
        let proxy_url = format!("http://127.0.0.1:{}", port);
        command
            .env("HTTP_PROXY", &proxy_url)
            .env("HTTPS_PROXY", &proxy_url)
            .env("http_proxy", &proxy_url)
            .env("https_proxy", &proxy_url)
            .env("ALL_PROXY", &proxy_url)
            .env("all_proxy", &proxy_url)
            .env("NO_PROXY", "localhost,127.0.0.1,::1")
            .env("no_proxy", "localhost,127.0.0.1,::1")
            .env("NODE_EXTRA_CA_CERTS", "")
            .env("npm_config_proxy", &proxy_url)
            .env("npm_config_https_proxy", &proxy_url);
    }

    command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    // Apply enforcement layers in the fork-gap.
    let temp_dir_for_exec = temp_dir.clone();
    unsafe {
        command.pre_exec(move || {
            if !enabled {
                return Ok(());
            }

            // LAYER 0: POSIX resource limits (cross-platform)
            apply_resource_limits(512 * 1024 * 1024, 20);

            // LAYER 1: Filesystem jail
            // Note: denyWrite/denyRead for subpaths of allowed parents are not
            // enforceable with Landlock (purely additive allowlist). macOS Seatbelt
            // handles these fully via the profile above. Paths outside the allowed
            // set are already denied.
            #[cfg(target_os = "linux")]
            if !opts.deny_write_paths.is_empty() {
                eprintln!(
                    "[SANDBOX] WARNING: denyWrite paths are best-effort on Linux: {:?}",
                    opts.deny_write_paths
                );
            }
            #[cfg(target_os = "linux")]
            if !opts.deny_read_paths.is_empty() {
                eprintln!(
                    "[SANDBOX] WARNING: denyRead paths are best-effort on Linux: {:?}",
                    opts.deny_read_paths
                );
            }
            match apply_landlock_policy(&workspace_owned, &temp_dir_for_exec, &opts.allow_write_paths) {
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

            // LAYER 2: Seccomp-BPF — Privilege escalation kill + network block
            if let Err(e) = apply_seccomp_policy(deny_network) {
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
        temp_dir: Some(temp_dir),
    })
}

// ---------------------------------------------------------------------------
// macOS: Seatbelt profile generator for sandbox-exec
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn generate_seatbelt_profile(
    workspace: &Path,
    home_dir: &str,
    temp_dir: &Path,
    deny_network: bool,
    allow_write: &[PathBuf],
    deny_write: &[PathBuf],
    deny_read: &[PathBuf],
) -> String {
    let ws = workspace.to_string_lossy();
    let td = temp_dir.to_string_lossy();

    // System paths that the process needs read-only access to.
    // Note: /private/tmp is intentionally excluded — we use isolated temp dirs.
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

    // Isolated temp directory — full read/write (replaces /private/tmp)
    profile.push_str(&format!(
        "(allow file-read* (subpath \"{}\"))\n",
        td
    ));
    profile.push_str(&format!(
        "(allow file-write* (subpath \"{}\"))\n",
        td
    ));

    // Root directory for path resolution
    profile.push_str("(allow file-read* (literal \"/\"))\n");

    // Executable mapping (required for dyld)
    profile.push_str("(allow file-map-executable)\n");

    // System RO paths
    for p in &system_ro_paths {
        profile.push_str(&format!("(allow file-read* (subpath \"{}\"))\n", p));
    }

    // Credential scoping — deny access to sensitive paths even from workspace
    let sensitive_paths = [
        "/.ssh",
        "/.aws",
        "/.config/git",
        "/.gnupg",
        "/.netrc",
        "/.npmrc",
        "/.docker",
        "/.kube",
        "/.azure",
        "/.gpg",
    ];
    for suffix in &sensitive_paths {
        let full_path = format!("{}{}", home_dir, suffix);
        profile.push_str(&format!(
            "(deny file-read* (subpath \"{}\"))\n",
            full_path
        ));
    }

    // Custom denyRead paths (additive to credential scoping)
    for p in deny_read {
        profile.push_str(&format!(
            "(deny file-read* (subpath \"{}\"))\n",
            p.display()
        ));
    }

    // Custom denyWrite paths (overrides any allow)
    for p in deny_write {
        profile.push_str(&format!(
            "(deny file-write* (subpath \"{}\"))\n",
            p.display()
        ));
    }

    // Custom allowWrite paths (additional writable locations outside workspace)
    for p in allow_write {
        profile.push_str(&format!(
            "(allow file-write* (subpath \"{}\"))\n",
            p.display()
        ));
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

    // Network policy — default-deny outbound, allow localhost only
    if deny_network {
        profile.push_str("(deny network-outbound)\n");
        profile.push_str("(allow network-outbound (remote ip \"localhost:*\"))\n");
        profile.push_str("(allow network* (local ip \"localhost:*\"))\n");
    } else {
        profile.push_str("(allow network*)\n");
    }

    profile
}

// ---------------------------------------------------------------------------
// Layer 1: Landlock v2 — Symlink-Safe Filesystem Jail (Linux only)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn apply_landlock_policy(workspace: &Path, temp_dir: &Path, allow_write: &[PathBuf]) -> Result<bool> {
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

    // Isolated temp directory: Full RWX
    // Note: /tmp is intentionally NOT in the allowed paths — sandboxed processes
    // get exclusive access to their own temp dir only, preventing side-channel attacks.
    let temp_full_access = AccessFs::from_all(abi);
    let temp_fd = PathFd::new(temp_dir)
        .with_context(|| format!("Failed to open temp dir fd: {}", temp_dir.display()))?;
    ruleset = ruleset
        .add_rule(PathBeneath::new(temp_fd, temp_full_access))
        .with_context(|| format!("Failed to add temp dir rule: {}", temp_dir.display()))?;

    // Additional allowWrite paths: Full RWX
    for p in allow_write {
        if !p.exists() {
            tracing::debug!("[LANDLOCK] allowWrite path {} does not exist, skipping", p.display());
            continue;
        }
        let fd = PathFd::new(p)
            .with_context(|| format!("Failed to open allowWrite fd: {}", p.display()))?;
        ruleset = ruleset
            .add_rule(PathBeneath::new(fd, temp_full_access))
            .with_context(|| format!("Failed to add allowWrite rule for: {}", p.display()))?;
        tracing::info!("[LANDLOCK] allowWrite path added: {}", p.display());
    }

    // System paths: Read-only (no /tmp — temp isolation)
    let ro_access = AccessFs::from_read(abi);
    let system_ro_paths = [
        "/lib", "/lib64", "/usr/lib", "/usr/lib64",
        "/bin", "/usr/bin", "/sbin", "/usr/sbin",
        "/usr/local/bin", "/usr/share", "/usr/local/lib",
        "/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/ld.so.conf.d",
        "/etc/localtime", "/proc/self",
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
fn apply_landlock_policy(_workspace: &Path, _temp_dir: &Path, _allow_write: &[PathBuf]) -> Result<bool> {
    Ok(true)
}

// ---------------------------------------------------------------------------
// Layer 2: Seccomp-BPF — Privilege Escalation Kill Only (Linux only)
// ---------------------------------------------------------------------------

#[cfg(target_os = "linux")]
fn apply_seccomp_policy(deny_network: bool) -> Result<()> {
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

    // Network isolation — block socket/connect/bind/listen/accept if deny_network is true
    if deny_network {
        let network_syscalls = [
            "connect", "bind", "listen", "accept", "accept4",
            "sendto", "recvfrom", "sendmsg", "recvmsg",
        ];
        for syscall_name in &network_syscalls {
            match ScmpSyscall::from_name(syscall_name) {
                Ok(syscall) => {
                    filter.add_rule(ScmpAction::KillProcess, syscall)
                        .with_context(|| format!("Failed to add network kill rule for: {}", syscall_name))?;
                }
                Err(_) => {
                    tracing::debug!(
                        "[SECCOMP] Network syscall '{}' not found on this kernel, skipping.",
                        syscall_name
                    );
                }
            }
        }

        // Block socket() for AF_INET (2) and AF_INET6 (10), allow AF_UNIX (1)
        let sys_socket = ScmpSyscall::from_name("socket");
        if let Ok(socket_syscall) = sys_socket {
            let _ = filter.add_rule_conditional(
                ScmpAction::KillProcess,
                socket_syscall,
                &[ScmpArgCompare::new(0, ScmpCompareOp::Equal, 2)],
            );
            let _ = filter.add_rule_conditional(
                ScmpAction::KillProcess,
                socket_syscall,
                &[ScmpArgCompare::new(0, ScmpCompareOp::Equal, 10)],
            );
        }
    }

    filter.load().context("Failed to load Seccomp filter into kernel")?;

    if deny_network {
        tracing::info!("[SECCOMP] Filter active. Default: ALLOW. Network: DENIED. Privesc: KILL.");
    } else {
        tracing::info!("[SECCOMP] Filter active. Default: ALLOW. Network: ALLOWED. Privesc: KILL.");
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn apply_seccomp_policy(_deny_network: bool) -> Result<()> {
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
        assert!(opts.deny_network);
        assert!(!opts.excluded_commands.is_empty());
        assert!(opts.excluded_commands.contains(&"docker".to_string()));
    }

    #[test]
    fn test_excluded_commands_docker() {
        let opts = SandboxOptions::default();
        let result = spawn_sandboxed_command(
            "docker",
            &["ps".to_string()],
            Path::new("/tmp"),
            opts,
            true,
        );
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("excluded from sandbox"));
        assert!(err.contains("docker"));
    }

    #[test]
    fn test_excluded_commands_sudo() {
        let opts = SandboxOptions::default();
        let result = spawn_sandboxed_command(
            "sudo",
            &["echo".to_string(), "hi".to_string()],
            Path::new("/tmp"),
            opts,
            true,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_basic_execution() {
        let opts = SandboxOptions {
            excluded_commands: vec![],
            ..Default::default()
        };
        let workspace = std::env::temp_dir().join("sandbox_test_basic");
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).unwrap();

        let child = spawn_sandboxed_command(
            "sh",
            &["-c".to_string(), "echo hello".to_string()],
            &workspace,
            opts,
            true,
        ).unwrap();

        let output = child.wait_with_output().unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success());
        assert!(stdout.contains("hello"));

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_temp_dir_created() {
        let opts = SandboxOptions {
            excluded_commands: vec![],
            ..Default::default()
        };
        let workspace = std::env::temp_dir().join("sandbox_test_tempdir");
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).unwrap();

        let child = spawn_sandboxed_command(
            "echo",
            &["hello".to_string()],
            &workspace,
            opts,
            true,
        ).unwrap();

        assert!(child.temp_dir.is_some());
        let td_path = child.temp_dir.clone().unwrap();
        assert!(td_path.exists());
        assert!(td_path.to_string_lossy().contains("unit01-"));

        drop(child);
        assert!(!td_path.exists());

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_temp_dir_writable() {
        let opts = SandboxOptions {
            excluded_commands: vec![],
            ..Default::default()
        };
        let workspace = std::env::temp_dir().join("sandbox_test_tmpwrite");
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).unwrap();

        let child = spawn_sandboxed_command(
            "sh",
            &["-c".to_string(), "touch \"$TMPDIR/testfile\" && echo written".to_string()],
            &workspace,
            opts,
            true,
        ).unwrap();

        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(stdout.contains("written"));

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_excluded_commands_custom_list() {
        let opts = SandboxOptions {
            excluded_commands: vec!["myblockedtool".to_string()],
            ..Default::default()
        };
        let result = spawn_sandboxed_command(
            "myblockedtool",
            &[],
            Path::new("/tmp"),
            opts,
            true,
        );
        assert!(result.is_err());
    }
}
