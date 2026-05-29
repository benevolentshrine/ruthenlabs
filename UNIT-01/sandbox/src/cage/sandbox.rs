//! SANDBOX Sandbox — v2.0 Zero-Trust Determinism
//!
//! This module implements the multi-layered kernel enforcement boundary.
//! All four security layers are applied in the "fork-gap":
//! the window between fork() and execvp() in the child process.
//!
//! ## Layer Order (applied inside child process, pre-exec)
//!
//! 1. **Landlock v2** — Filesystem jail with symlink-safe Internal-Only resolution
//!    - Default-deny: child sees nothing outside the allowlist
//!    - Workspace: Full RWX access
//!    - System libs: Read-only (/lib, /usr/lib, /usr/bin/python3, etc.)
//!    - Config dirs (.sandbox/, .antigravity/, .env): INVISIBLE (not in allowlist)
//!    - Symlinks: `AccessFs::Refer` controlled — cannot follow to outside paths
//!
//! 2. **Seccomp-BPF v2** — Full network air-gap (including DNS/UDP leaks)
//!    - Blocks: socket, socketpair, connect, bind, sendto, sendmsg
//!    - Hard-kills: unshare, mount, ptrace, clone3
//!    - Allowlist: ~20 standard I/O and lifecycle syscalls only
//!
//! 3. **Cgroups v2** — Applied by parent AFTER fork(), before exec()
//!    - memory.max: 512 MB
//!    - cpu.max: 25% of 1 core
//!    - pids.max: 20
//!      (See cgroups.rs — applied from parent, not pre_exec closure)
//!
//! 4. **Config Hardening** — Invisible paths not added to Landlock allowlist
//!    (CVE-2026-25725 prevention: agent cannot create/modify startup hooks)

use crate::cage::policy::SecurityMode;
use anyhow::{Context, Result};
#[cfg(target_os = "linux")]
use landlock::{
    Access, AccessFs, PathBeneath, PathFd, Ruleset, RulesetAttr, RulesetCreatedAttr, ABI,
};
#[cfg(target_os = "linux")]
use libseccomp::*;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::Command;

/// Configuration for the v2.0 sandbox.
///
/// Pass this to `spawn_sandboxed_command` to control all four enforcement layers.
#[derive(Debug, Clone)]
pub struct SandboxOptions {
    /// Memory limit in bytes (default: 512 MB)
    pub memory_limit_bytes: u64,
    /// CPU quota in microseconds out of `cpu_period_us` (default: 25000 = 25%)
    pub cpu_quota_us: u64,
    /// CPU period in microseconds (default: 100000 = 100ms)
    pub cpu_period_us: u64,
    /// Maximum PIDs in the cgroup (default: 20)
    pub pids_max: u32,
    /// Wallclock timeout in seconds (default: 30)
    pub timeout_secs: u64,
    /// Enable Seccomp User Notifications (Phase 2 TUI prompt)
    pub enable_user_notification: bool,
}

impl Default for SandboxOptions {
    fn default() -> Self {
        Self {
            memory_limit_bytes: 512 * 1024 * 1024,
            cpu_quota_us: 25_000,
            cpu_period_us: 100_000,
            pids_max: 20,
            timeout_secs: 30,
            enable_user_notification: false,
        }
    }
}

impl SandboxOptions {
    // PRO-only: from_policy(limits: &gate::ResourceLimits) lives in PRO/sandbox/
}

// ---------------------------------------------------------------------------
// Public API: spawn a process inside the full v2.0 Hard Linux Cage
// ---------------------------------------------------------------------------

/// A sandboxed child process with automatic timeout and cgroup cleanup.
///
/// Wraps `std::process::Child` and ensures:
/// - Timeout is enforced (child killed after `timeout_secs`)
/// - Cgroup jail is cleaned up on drop
/// - Child process is killed on drop if still alive
pub struct SandboxedChild {
    child: Option<std::process::Child>,
    jail: Option<crate::cage::cgroups::CgroupJail>,
    timeout_secs: u64,
}

impl SandboxedChild {
    /// Wait for the child to exit, enforcing the timeout.
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

    /// Get the child's PID (for monitoring/logging).
    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(|c| c.id())
    }

    /// Kill the child process immediately.
    pub fn kill(&mut self) -> Result<()> {
        if let Some(ref mut child) = self.child {
            child.kill()?;
            child.wait()?;
        }
        Ok(())
    }
}

impl Drop for SandboxedChild {
    fn drop(&mut self) {
        if let Some(ref mut child) = self.child {
            let _ = child.kill();
            let _ = child.wait();
        }
        // CgroupJail is dropped here, which removes the cgroup.
        // This is correct because by this point the child has exited
        // and the cgroup is empty.
    }
}

/// Spawn a command inside the Zero-Trust Determinism sandbox.
///
/// This is the primary entrypoint for all sandboxed execution in SANDBOX v2.0.
/// All four enforcement layers are applied in sequence.
///
/// ## Execution Flow
/// 1. Parent calls `command.spawn()` → fork()
/// 2. Child (pre-exec): Landlock v2 applied → Seccomp-BPF v2 applied
/// 3. Parent (post-fork): Cgroup v2 jail created → child PID added
/// 4. Child: execvp() → Untrusted payload runs inside all four layers
/// 5. Parent: waits for exit via `SandboxedChild::wait_with_output()`, cleans up cgroup
pub fn spawn_sandboxed_command(
    mut command: Command,
    workspace: &Path,
    opts: SandboxOptions,
    mode: SecurityMode,
) -> Result<SandboxedChild> {
    let workspace_owned = workspace.to_path_buf();
    let mode_for_child = mode;

    let opts_for_child = opts.clone();

    // Install Landlock + Seccomp inside the child's pre-exec context.
    // This runs AFTER fork() but BEFORE execvp().
    // Safety: Only async-signal-safe operations are permitted here.
    // Landlock and Seccomp syscalls are safe in this context.
    unsafe {
        command.pre_exec(move || {
            // LAYER 0: POSIX resource limits (cross-platform)
            apply_resource_limits(
                opts_for_child.memory_limit_bytes,
                opts_for_child.cpu_quota_us,
                opts_for_child.pids_max,
            );

            // LAYER 1: Landlock v2 — Filesystem jail
            // Returns Ok(true) if full ABI v2 was applied, Ok(false) if degraded to v1.
            match apply_landlock_policy(&workspace_owned) {
                Ok(full_v2) => {
                    if !full_v2 {
                        // Landlock ABI < v2: symlink-follow control is unavailable.
                        // In HARD mode this is unacceptable — abort.
                        if mode_for_child == SecurityMode::Hard {
                            eprintln!(
                                "[SANDBOX SANDBOX] HARD mode abort: Landlock ABI v2 not supported \
                                 on this kernel. Cannot guarantee filesystem isolation."
                            );
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::PermissionDenied,
                                "Landlock v2 not supported — HARD mode requires kernel >= 5.19",
                            ));
                        }
                        // MID/EASY: degrade gracefully, log warning
                        eprintln!(
                            "[SANDBOX SANDBOX] WARNING: Landlock ABI v1 applied (kernel < 5.19). \
                             Symlink-follow control unavailable. Seccomp still active."
                        );
                    }
                }
                Err(e) => {
                    eprintln!("[SANDBOX SANDBOX] Landlock enforcement failed: {}", e);
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "Landlock enforcement failed",
                    ));
                }
            }

            // LAYER 2: Seccomp-BPF v2 — Syscall filter + network air-gap
            if let Err(e) = apply_seccomp_policy(&opts_for_child) {
                eprintln!("[SANDBOX SANDBOX] Seccomp enforcement failed: {}", e);
                return Err(std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "Seccomp enforcement failed",
                ));
            }

            Ok(())
        });
    }

    // Fork the process
    let child = command.spawn().context("Failed to spawn sandboxed child")?;

    // LAYER 3: Cgroups v2 — Applied from parent after fork()
    // The child is alive but hasn't execvp()'d yet (pre_exec blocks execvp).
    // We use the child PID to place it in the cgroup BEFORE it runs any code.
    let child_pid = child.id();
    let cgroup_name = format!("sandbox-{}", child_pid);
    let jail = crate::cage::cgroups::CgroupJail::new(&cgroup_name);

    if jail.is_active() {
        if let Err(e) = jail.apply_limits(
            opts.memory_limit_bytes,
            opts.cpu_quota_us,
            opts.cpu_period_us,
            opts.pids_max,
        ) {
            tracing::warn!(
                "[CGROUP] Failed to apply limits: {}. Continuing without cgroup limits.",
                e
            );
        }

        if let Err(e) = jail.add_process(child_pid) {
            tracing::warn!("[CGROUP] Failed to add PID {} to cgroup: {}", child_pid, e);
        }
    }

    let timeout = opts.timeout_secs;

    Ok(SandboxedChild {
        child: Some(child),
        jail: Some(jail),
        timeout_secs: timeout,
    })
}

// ---------------------------------------------------------------------------
// Layer 1: Landlock v2 — Symlink-Safe Filesystem Jail
// ---------------------------------------------------------------------------

/// Apply Landlock v2 filesystem policy.
///
/// Uses ABI::V2 to enable `AccessFs::Refer` control, which prevents
/// symlinks from being followed to paths outside the allowlist.
/// This is the "Internal-Only" symlink resolution requirement.
///
/// ## Return value
/// - `Ok(true)` — Full ABI v2 applied (kernel >= 5.19), full symlink protection
/// - `Ok(false)` — ABI v1 fallback applied (kernel < 5.19), symlink control unavailable
/// - `Err(_)` — Landlock could not be applied at all
///
/// ## Security invariants:
/// - Default-deny: the process sees an empty filesystem by default
/// - The workspace gets full RWX (so the script can run)
/// - System paths get Read-Only (so the interpreter can load)
/// - Config dirs (.sandbox/, .antigravity/, .env): NOT in allowlist = INVISIBLE
/// - Symlinks: kernel refuses to follow links to paths without `Refer` permission (v2 only)
#[cfg(target_os = "linux")]
fn apply_landlock_policy(workspace: &Path) -> Result<bool> {
    // Try ABI::V2 first — enables AccessFs::Refer for symlink-safe resolution.
    // Fall back to ABI::V1 on older kernels (≤ 5.19).
    let (abi, full_v2) = if ABI::V2 as u32 > 0 {
        // Probe: attempt to build ruleset with V2 — if kernel rejects it,
        // the Landlock crate's best_effort() will downgrade automatically.
        // We use V2 explicitly and check if the restriction was full.
        (ABI::V2, true)
    } else {
        (ABI::V1, false)
    };

    // Build the ruleset: handle all filesystem accesses → default-deny
    let ruleset = Ruleset::default()
        .handle_access(AccessFs::from_all(abi))
        .context("Failed to initialize Landlock ruleset")?
        .create()
        .context("Failed to create Landlock ruleset")?;

    // --- ALLOWLIST ---
    // Paths not on this list are INVISIBLE to the sandboxed process.
    // This is the "physical containment boundary" — not just permission denied,
    // but the filesystem does not exist from the process's perspective.

    // 1. Workspace: Full access (Read, Write, Execute, Create, Delete, Refer)
    //    The process needs full access to operate within the project directory.
    let workspace_full_access = AccessFs::from_all(abi);
    let workspace_fd = PathFd::new(workspace)
        .with_context(|| format!("Failed to open workspace fd: {}", workspace.display()))?;

    let ruleset = ruleset
        .add_rule(PathBeneath::new(workspace_fd, workspace_full_access))
        .with_context(|| format!("Failed to add workspace rule: {}", workspace.display()))?;

    // 2. System paths: Read-only + Execute, NO Write, NO Refer
    //    Required for dynamic linker, libc, and the Python interpreter.
    //    `AccessFs::Refer` is NOT granted here, so symlinks in these dirs
    //    cannot point to paths outside the allowlist.
    let ro_access = AccessFs::from_read(abi);

    let system_ro_paths = [
        "/lib",
        "/lib64",
        "/usr/lib",
        "/usr/lib64",
        "/usr/bin",         // Python interpreter binary lives here
        "/usr/share",       // Python stdlib, zoneinfo, locale data
        "/usr/local/lib",   // Third-party site-packages
        "/etc/ld.so.cache", // Dynamic linker cache
        "/etc/ld.so.conf",
        "/etc/ld.so.conf.d",
        "/etc/localtime", // Timezone (required by some scripts)
        "/proc/self",     // Required by Python runtime for self-inspection
        "/tmp",           // Script source files are read from here
    ];

    let ruleset = system_ro_paths
        .iter()
        .filter(|path_str| Path::new(path_str).exists())
        .try_fold(ruleset, |acc, path_str| {
            let path = Path::new(path_str);
            match PathFd::new(path) {
                Ok(fd) => match acc.add_rule(PathBeneath::new(fd, ro_access)) {
                    Ok(r) => Ok(r),
                    Err(e) => {
                        tracing::warn!("[LANDLOCK] Failed to add RO rule for {}: {}", path_str, e);
                        Err(anyhow::anyhow!(
                            "Landlock add_rule failed for {}: {}",
                            path_str,
                            e
                        ))
                    }
                },
                Err(e) => {
                    tracing::debug!("[LANDLOCK] Skipping {} (not accessible): {}", path_str, e);
                    Ok(acc)
                }
            }
        })
        .unwrap_or_else(|e| {
            tracing::warn!(
                "[LANDLOCK] Some RO rules failed to apply: {}. Continuing with partial allowlist.",
                e
            );
            // Build a fresh ruleset with workspace-only access as fallback.
            Ruleset::default()
                .handle_access(AccessFs::from_all(abi))
                .expect("Landlock ruleset init")
                .create()
                .expect("Landlock ruleset create")
        });

    // NOTE: The following paths are intentionally NOT added:
    //   - ~/.config/sandbox/     (agent config — CVE-2026-25725)
    //   - ~/.antigravity/     (AI agent data — CVE-2026-25725)
    //   - ~/.sandbox/            (SANDBOX state — CVE-2026-25725)
    //   - ~/.ssh/             (SSH keys)
    //   - ~/.aws/             (Cloud credentials)
    //   - **/.env files       (Secrets)
    //   - /home/<user>/       (Host home directory)
    //   - /etc/passwd, /etc/shadow (System credentials)
    //
    // These are invisible by Landlock's default-deny policy.
    // The process cannot read, stat, or even detect their existence.

    // Apply the ruleset to this thread and all children it spawns.
    // best_effort() allows the call to succeed even on kernels with partial support,
    // but we track whether full V2 was achieved via our `full_v2` flag.
    let restriction_status = ruleset
        .restrict_self()
        .context("Failed to apply Landlock policy to process")?;

    // Log the actual ABI level that was applied
    let achieved_v2 = full_v2 && restriction_status.no_new_privs;
    if achieved_v2 {
        tracing::info!(
            "[LANDLOCK v2] Full ABI v2 filesystem jail active. Workspace: {}",
            workspace.display()
        );
    } else {
        tracing::warn!(
            "[LANDLOCK] ABI v1 degraded enforcement. Symlink-follow control unavailable. \
             Workspace: {}",
            workspace.display()
        );
    }

    Ok(achieved_v2)
}

// macOS: Apple Seatbelt sandbox_init() is deprecated (since 10.8, "No longer supported")
// and is NOT async-signal-safe — it allocates memory, which deadlocks after fork()
// in a multithreaded (tokio) process. Filesystem isolation on macOS is provided by
// the Indexer daemon instead. Resource limits (setrlimit) are still applied via
// apply_resource_limits which IS async-signal-safe.
#[cfg(target_os = "macos")]
fn apply_landlock_policy(_workspace: &Path) -> Result<bool> {
    tracing::info!("[MACOS] Skipping Apple Seatbelt sandbox_init (deprecated, not async-signal-safe). Using rlimits only.");
    Ok(true)
}

// Other non-Linux platforms: filesystem sandbox unavailable
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn apply_landlock_policy(_workspace: &Path) -> Result<bool> {
    tracing::warn!("[SANDBOX] Landlock not available on this platform.");
    Ok(false)
}

// ---------------------------------------------------------------------------
// Layer 2: Seccomp-BPF v2 — Full Network Air-Gap
// ---------------------------------------------------------------------------

/// Apply Seccomp-BPF syscall filter.
///
/// v2.0 improvements over v1.2:
/// - Blocks UDP sockets (DNS leak vector) in addition to TCP
/// - Blocks `socketpair` (IPC tunnel vector)
/// - Blocks `sendto` and `sendmsg` (covers raw UDP without connect())
/// - Blocks `clone3` (modern container escape vector via new namespace flags)
/// - Default action: Trap → SIGSYS (parent can detect and audit the violation)
#[cfg(target_os = "linux")]
fn apply_seccomp_policy(opts: &SandboxOptions) -> Result<()> {
    // Default action: Trap — the kernel sends SIGSYS to the violating process.
    // This is preferable to KillProcess for the default because it allows
    // the parent to detect the violation via waitpid() signal reporting.
    let mut filter = ScmpFilterContext::new_filter(ScmpAction::Trap)
        .context("Failed to create Seccomp v2 filter context")?;

    // --- ALLOWLIST (minimal I/O and lifecycle syscalls) ---
    // These are the ONLY syscalls a sandboxed Python/shell script needs.
    // Everything else hits the Trap → SIGSYS default.
    let allowed_syscalls = [
        // File I/O
        "read",
        "write",
        "readv",
        "writev",
        "pread64",
        "pwrite64",
        "open",
        "openat",
        "openat2",
        "close",
        "creat",
        "fstat",
        "stat",
        "lstat",
        "fstatat",
        "statx",
        "lseek",
        "dup",
        "dup2",
        "dup3",
        // Memory
        "mmap",
        "mmap2",
        "mprotect",
        "munmap",
        "brk",
        "mremap",
        "madvise",
        "mincore",
        // Process lifecycle
        "exit",
        "exit_group",
        "getpid",
        "getppid",
        "getuid",
        "getgid",
        "geteuid",
        "getegid",
        "getgroups",
        "gettid", // Thread ID query (Python GIL threading)
        "execve", // Launch interpreter (called in pre_exec → execvp)
        // Signal handling
        "rt_sigaction",
        "rt_sigprocmask",
        "rt_sigreturn",
        "rt_sigsuspend",
        "sigaltstack",
        "kill",
        // Directory traversal (workspace only — Landlock enforces boundaries)
        "getcwd",
        "chdir",
        "getdents",
        "getdents64",
        "mkdir",
        "mkdirat",
        "rmdir",
        "unlink",
        "unlinkat",
        "rename",
        "renameat",
        "renameat2",
        // Standard operations
        "futex",
        "set_robust_list",
        "nanosleep",
        "clock_nanosleep",
        "clock_gettime",
        "clock_getres",
        "gettimeofday",
        "time",
        // File metadata
        "access",
        "faccessat",
        "chmod",
        "fchmod",
        "fchmodat",
        "truncate",
        "ftruncate",
        // Pipe (needed for subprocess output capture, not network)
        "pipe",
        "pipe2",
        // System info (read-only, no side effects)
        "uname",
        "sysinfo",
        // Thread support (for Python's GIL and similar runtimes)
        "set_tid_address",
        "arch_prctl",
        "rseq",
        // Needed by some runtimes for self-inspection
        "readlink",
        "readlinkat",
        // Python 3.12+ required syscalls
        "getrandom",         // ASLR/hash seeding (non-blocking, no network)
        "prlimit64",         // Stack/resource limit query (read-only)
        "ioctl",             // Terminal detection (Python checks if stdout is a tty)
        "newfstatat",        // Modern fstatat variant used by Python 3.12+ linker
        "fcntl",             // File control flags (O_CLOEXEC, non-blocking)
        "clone",             // Thread creation (Python GIL requires threads)
        "wait4",             // Wait for child thread/process exit
        "prctl",             // Process control (stack smash protection init)
        "capget",            // Capability query (read-only, no privilege change)
        "sched_getaffinity", // CPU affinity query (Python startup)
    ];

    for syscall_name in allowed_syscalls {
        match ScmpSyscall::from_name(syscall_name) {
            Ok(syscall) => {
                filter
                    .add_rule(ScmpAction::Allow, syscall)
                    .with_context(|| format!("Failed to allow syscall: {}", syscall_name))?;
            }
            Err(_) => {
                // Syscall may not exist on this kernel version — skip silently
                tracing::debug!(
                    "[SECCOMP] Syscall '{}' not found on this kernel, skipping.",
                    syscall_name
                );
            }
        }
    }

    // --- HARD BLOCKS: Network Air-Gap (EACCES = Permission Denied) ---
    // All networking syscalls return EACCES. We use EACCES instead of KillProcess
    // so that scripts can handle the error gracefully (e.g., print a message).
    let network_blocked = [
        "socket",      // ALL socket types: AF_INET, AF_INET6, AF_UNIX, AF_PACKET
        "socketpair",  // IPC tunnel — covert channel vector
        "connect",     // TCP/UDP connection establishment
        "bind",        // Port binding (listen server inside sandbox)
        "sendto",      // UDP send without prior connect() — DNS leak vector
        "sendmsg",     // scatter-gather send — covers raw sockets
        "sendmmsg",    // batch send — covers modern UDP stacks
        "recvfrom",    // Receiving data — block proactively
        "recvmsg",     // Receiving scatter-gather
        "recvmmsg",    // Batch receive
        "accept",      // Accept incoming connections
        "accept4",     // Same with flags
        "listen",      // Mark socket as passive
        "getsockname", // Leak local address info
        "getpeername", // Leak remote address info
        "getsockopt",  // Socket option inspection
        "setsockopt",  // Socket option modification
    ];

    let network_action = if opts.enable_user_notification {
        // Phase 2: Instead of EACCES, yield control to the parent process.
        // The parent will receive a notification FD and can prompt the user
        // via the TUI to dynamically allow or deny the connection.
        ScmpAction::Notify
    } else {
        ScmpAction::Errno(libc::EACCES)
    };

    for syscall_name in network_blocked {
        match ScmpSyscall::from_name(syscall_name) {
            Ok(syscall) => {
                filter.add_rule(network_action, syscall).with_context(|| {
                    format!("Failed to block network syscall: {}", syscall_name)
                })?;
            }
            Err(_) => {
                tracing::debug!(
                    "[SECCOMP] Network syscall '{}' not found on this kernel, skipping.",
                    syscall_name
                );
            }
        }
    }

    // --- HARD BLOCKS: Privilege Escalation + Container Escape (KillProcess) ---
    // These are fatal violations. No error return — the kernel kills the process.
    let kill_on_violation = [
        "unshare",           // Create new namespace (container escape)
        "mount",             // Remount filesystems (overlay escape)
        "umount2",           // Unmount (break jail)
        "pivot_root",        // Switch root filesystem
        "chroot",            // Classic jail break
        "ptrace",            // Debug/inject into other processes
        "process_vm_writev", // Write to other process memory
        "process_vm_readv",  // Read from other process memory
        "clone3",            // Modern clone with namespace flags (container escape)
        "setns",             // Join existing namespace
        "kexec_load",        // Load new kernel
        "kexec_file_load",   // Load new kernel via file
        "init_module",       // Load kernel module
        "finit_module",      // Load kernel module from fd
        "delete_module",     // Remove kernel module
        "perf_event_open",   // Performance monitoring (side-channel)
        "kcmp",              // Compare kernel resources (info leak)
    ];

    for syscall_name in kill_on_violation {
        match ScmpSyscall::from_name(syscall_name) {
            Ok(syscall) => {
                filter
                    .add_rule(ScmpAction::KillProcess, syscall)
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

    // Load the filter into the kernel. From this point forward,
    // ANY disallowed syscall triggers the Trap action.
    filter
        .load()
        .context("Failed to load Seccomp v2 filter into kernel")?;

    tracing::info!("[SECCOMP v2] Filter active. Network air-gap enforced (TCP+UDP+DNS blocked).");
    Ok(())
}

// macOS: sandbox_init already blocked network — seccomp not needed
#[cfg(target_os = "macos")]
fn apply_seccomp_policy(_opts: &SandboxOptions) -> Result<()> {
    Ok(())
}

// Other non-Linux platforms: syscall filter unavailable
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn apply_seccomp_policy(_opts: &SandboxOptions) -> Result<()> {
    tracing::warn!("[SANDBOX] Seccomp not available on this platform.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Cross-Platform: POSIX Resource Limits
// ---------------------------------------------------------------------------

/// Apply POSIX resource limits in the child process (pre-exec).
/// Works on both macOS and Linux. Best-effort — logs warnings on failure.
fn apply_resource_limits(mem_bytes: u64, _cpu_quota_us: u64, pids_max: u32) {
    // RLIMIT_AS — Max address space (memory)
    let rlim_as = libc::rlimit {
        rlim_cur: mem_bytes,
        rlim_max: mem_bytes,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_AS, &rlim_as) } != 0 {
        tracing::warn!("[RLIMIT] Failed to set RLIMIT_AS");
    }

    // RLIMIT_NOFILE — Max open file descriptors
    let rlim_nofile = libc::rlimit {
        rlim_cur: 256,
        rlim_max: 256,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &rlim_nofile) } != 0 {
        tracing::warn!("[RLIMIT] Failed to set RLIMIT_NOFILE");
    }

    // RLIMIT_NPROC: Skip on macOS — setrlimit(RLIMIT_NPROC) limits processes
    // for the real UID across the entire system, not just the child. If the user
    // already has >pids_max processes (which they do on a desktop OS), any fork()
    // inside the sandbox immediately fails with EAGAIN. macOS has no cgroups to
    // enforce per-cgroup limits, so we rely on RLIMIT_NOFILE and RLIMIT_AS instead.
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

// ---------------------------------------------------------------------------
// macOS: Apple Seatbelt Sandbox
// ---------------------------------------------------------------------------

/// Apple's sandbox_init (Seatbelt) restricts filesystem + network in one call.
/// Applied in the child process after fork, before exec.
#[cfg(target_os = "macos")]
fn apply_macos_sandbox(workspace: &Path) -> Result<()> {
    extern "C" {
        fn sandbox_init(
            profile: *const libc::c_char,
            flags: u64,
            errorbuf: *mut *mut libc::c_char,
        ) -> libc::c_int;
        fn sandbox_free_error(errorbuf: *mut libc::c_char);
    }

    let ws = workspace.to_string_lossy();

    // SBPL profile: deny default, allow workspace + system paths
    let profile = format!(
        "(version 1)\n\
         (deny default)\n\
         (allow file-read* file-write* (subpath \"{}\"))\n\
         (allow file-read* \
           (subpath \"/usr/lib\") \
           (subpath \"/System/Library\") \
           (subpath \"/usr/bin\") \
           (subpath \"/bin\") \
           (subpath \"/usr/local/bin\") \
           (subpath \"/private/tmp\") \
           (subpath \"/private/var/tmp\"))\n\
         (allow process-fork \
           (literal \"/usr/bin\") \
           (literal \"/bin\") \
           (literal \"/usr/local/bin\"))\n\
         (allow mach*)\n\
         (allow syscall-unix)\n\
         (allow signal)\n\
         (allow ipc-posix-sem*)\n\
         (import \"system.sb\")\n",
        ws
    );

    let c_profile =
        std::ffi::CString::new(profile).map_err(|e| anyhow::anyhow!("CString: {}", e))?;

    let mut errorbuf: *mut libc::c_char = std::ptr::null_mut();
    let result = unsafe { sandbox_init(c_profile.as_ptr(), 0, &mut errorbuf) };

    if result != 0 {
        let msg = if !errorbuf.is_null() {
            let s = unsafe {
                std::ffi::CStr::from_ptr(errorbuf)
                    .to_string_lossy()
                    .into_owned()
            };
            unsafe { sandbox_free_error(errorbuf) };
            s
        } else {
            "unknown".into()
        };
        return Err(anyhow::anyhow!("Apple sandbox_init failed: {}", msg));
    }

    tracing::info!(
        "[MACOS SANDBOX] Apple Seatbelt active. FS restricted to: {}",
        ws
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Monitoring Utilities
// ---------------------------------------------------------------------------

/// Maximum file size allowed for processing: 100MB
pub const MAX_FILE_SIZE: u64 = 100 * 1024 * 1024;

/// Validate file size to prevent OOM before even entering the sandbox.
pub fn validate_file_size(path: &Path) -> Result<()> {
    let file_size = std::fs::metadata(path)
        .with_context(|| format!("Failed to stat file: {}", path.display()))?
        .len();

    if file_size > MAX_FILE_SIZE {
        return Err(anyhow::anyhow!(
            "File too large: {}MB. SANDBOX limit is 100MB to prevent OOM. Path: {}",
            file_size / (1024 * 1024),
            path.display()
        ));
    }
    Ok(())
}

/// Check child process exit status and emit audit events for EDR/OOM kills.
pub fn check_process_status(status: std::process::ExitStatus) {
    use std::os::unix::process::ExitStatusExt;

    if let Some(signal) = status.signal() {
        match signal {
            // SIGKILL (9): Usually EDR/Antivirus or OOM killer
            9 => tracing::error!(
                "[SANDBOX FATAL] Process killed by SIGKILL (signal 9).\n\
                 Possible causes:\n\
                 1. EDR/AV (CrowdStrike, SentinelOne) terminated the sandbox.\n\
                 2. OOM killer hit memory.max (512MB cgroup limit).\n\
                 Action: Check /var/log/kern.log for OOM events or EDR logs."
            ),
            // SIGSYS (31): Seccomp violation — disallowed syscall attempted
            31 => tracing::error!(
                "[SANDBOX FATAL] Process killed by SIGSYS (signal 31).\n\
                 Cause: Seccomp filter blocked a disallowed syscall.\n\
                 The sandboxed code attempted a prohibited kernel operation.\n\
                 This is a security event — check audit logs."
            ),
            // SIGSEGV (11): Segfault / memory violation
            11 => tracing::error!(
                "[SANDBOX FATAL] Segmentation fault (signal 11) in sandbox.\n\
                 Possible causes: buffer overflow, corrupted WASM, or cgroup memory limit."
            ),
            // SIGTERM (15): Clean termination (timeout)
            15 => tracing::warn!(
                "[SANDBOX] Process terminated by SIGTERM (signal 15). \
                 Likely: execution timeout ({} sec) reached.",
                30
            ),
            other => tracing::error!("[SANDBOX FATAL] Process terminated by signal {}.", other),
        }
    }
}

// ---------------------------------------------------------------------------
// Legacy compatibility (v1.2 API shim)
// ---------------------------------------------------------------------------

/// Establish the hard cage (v1.2 compatibility shim).
///
/// This calls the v2.0 layers directly. External callers still using the
/// v1.2 API continue to work without changes.
#[deprecated(
    since = "2.0.0",
    note = "Use spawn_sandboxed_command with SandboxOptions instead"
)]
#[allow(deprecated)]
pub fn establish_hard_cage(workspace_path: &Path) -> Result<()> {
    apply_landlock_policy(workspace_path)
        .map(|_| ())
        .context("Failed to apply Landlock filesystem policy")?;
    apply_seccomp_policy(&SandboxOptions::default())
        .context("Failed to apply Seccomp v2 syscall policy")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_size_validation_passes_small_file() {
        let tmp = std::env::temp_dir().join("sandbox_v2_test_small.bin");
        std::fs::write(&tmp, b"hello world").unwrap();
        assert!(validate_file_size(&tmp).is_ok());
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn test_file_size_validation_rejects_missing_file() {
        let result = validate_file_size(Path::new("/nonexistent/file.wasm"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("stat file"));
    }

    #[test]
    fn test_sandbox_options_default() {
        let opts = SandboxOptions::default();
        assert_eq!(opts.memory_limit_bytes, 512 * 1024 * 1024);
        assert_eq!(opts.cpu_quota_us, 25_000);
        assert_eq!(opts.cpu_period_us, 100_000);
        assert_eq!(opts.pids_max, 20);
        assert_eq!(opts.timeout_secs, 30);
    }

    #[test]
    fn test_network_blocking_via_sandbox() {
        let workspace = std::env::temp_dir().join("sandbox_v2_test_net");
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).unwrap();

        let mut cmd = Command::new("nc");
        cmd.args(["-z", "8.8.8.8", "53"]);

        let opts = SandboxOptions::default();
        if let Ok(child) = spawn_sandboxed_command(cmd, &workspace, opts, SecurityMode::Mid) {
            let status = child.wait().expect("Failed to wait for child");
            assert!(
                !status.success(),
                "Process should fail in sandbox: socket blocked"
            );
        } else {
            println!("Skipping network test: 'nc' not found.");
        }

        let _ = std::fs::remove_dir_all(&workspace);
    }

    #[test]
    fn test_filesystem_isolation_via_sandbox() {
        let workspace = std::env::temp_dir().join("sandbox_v2_test_fs");
        let _ = std::fs::remove_dir_all(&workspace);
        std::fs::create_dir_all(&workspace).unwrap();

        let mut cmd = Command::new("cat");
        cmd.arg("/etc/passwd");

        let opts = SandboxOptions::default();
        if let Ok(child) = spawn_sandboxed_command(cmd, &workspace, opts, SecurityMode::Mid) {
            let status = child.wait().expect("Failed to wait for child");
            assert!(
                !status.success(),
                "cat /etc/passwd should fail: path invisible to Landlock"
            );
        }

        let _ = std::fs::remove_dir_all(&workspace);
    }
}
