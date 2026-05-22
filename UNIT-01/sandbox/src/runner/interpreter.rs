//! Interpreter Runner — v2.0 Zero-Trust Determinism
//!
//! PHASE 2.0 STRATEGY: Host interpreter wrapped in the full SANDBOX sandbox:
//! - Landlock v2 filesystem jail (workspace-only, symlink-safe)
//! - Seccomp-BPF v2 (network air-gap including DNS/UDP)
//! - Cgroups v2 (512MB RAM, 25% CPU, 20 PIDs)
//! - Pre-Execution Gate validation
//!
//! FUTURE PATH (documented in code):
//! - Python → rustpython.wasm
//! - JS/TS → quickjs.wasm
//! - Ruby → ruby.wasm
//!
//! This removes host dependency entirely.

use crate::classifier::magic::FileClass;
use crate::classifier::ClassificationResult;
use crate::runner::{DependencyStatus, Runner, RunnerVerdict};
use crate::cage::sandbox::{spawn_sandboxed_command, SandboxOptions};
use crate::cage::policy::{SecurityMode, SecurityPolicy};
use anyhow::{Context, Result};
use std::path::Path;
use std::process::Command;

/// Interpreter configuration
struct InterpreterConfig {
    /// Command to check (e.g., "python3")
    command: &'static str,
    /// Version flag (e.g., "--version")
    version_flag: &'static str,
    /// File extensions this handles
    extensions: &'static [&'static str],
}

/// Interpreter runner for scripted languages
pub struct InterpreterRunner {
    configs: Vec<InterpreterConfig>,
}

impl InterpreterRunner {
    /// Create a new interpreter runner
    pub fn new() -> Self {
        let configs = vec![
            InterpreterConfig {
                command: "python3",
                version_flag: "--version",
                extensions: &["py"],
            },
            InterpreterConfig {
                command: "node",
                version_flag: "--version",
                extensions: &["js", "ts", "mjs"],
            },
            InterpreterConfig {
                command: "ruby",
                version_flag: "--version",
                extensions: &["rb"],
            },
            InterpreterConfig {
                command: "php",
                version_flag: "--version",
                extensions: &["php"],
            },
            InterpreterConfig {
                command: "perl",
                version_flag: "--version",
                extensions: &["pl", "pm"],
            },
            InterpreterConfig {
                command: "lua",
                version_flag: "-v",
                extensions: &["lua"],
            },
            InterpreterConfig {
                command: "bash",
                version_flag: "--version",
                extensions: &["sh", "bash"],
            },
            InterpreterConfig {
                command: "zsh",
                version_flag: "--version",
                extensions: &["zsh"],
            },
            InterpreterConfig {
                command: "fish",
                version_flag: "--version",
                extensions: &["fish"],
            },
            InterpreterConfig {
                command: "pwsh",
                version_flag: "--version",
                extensions: &["ps1"],
            },
            InterpreterConfig {
                command: "Rscript",
                version_flag: "--version",
                extensions: &["r"],
            },
            InterpreterConfig {
                command: "swift",
                version_flag: "--version",
                extensions: &["swift"],
            },
            InterpreterConfig {
                command: "kotlin",
                version_flag: "-version",
                extensions: &["kt", "kts"],
            },
            InterpreterConfig {
                command: "scala",
                version_flag: "-version",
                extensions: &["scala", "sc"],
            },
        ];

        Self { configs }
    }

    /// Get interpreter config for a file class
    fn get_config_for_class(&self,
        class: &FileClass,
    ) -> Option<&InterpreterConfig> {
        let ext = match class {
            FileClass::Python => "py",
            FileClass::JavaScript => "js",
            FileClass::TypeScript => "ts",
            FileClass::Ruby => "rb",
            FileClass::Php => "php",
            FileClass::Perl => "pl",
            FileClass::Lua => "lua",
            FileClass::Shell => "sh",
            FileClass::PowerShell => "ps1",
            FileClass::R => "r",
            FileClass::Swift => "swift",
            FileClass::Kotlin => "kt",
            FileClass::Scala => "scala",
            _ => return None,
        };

        self.configs.iter().find(|c| c.extensions.contains(&ext))
    }

    /// Check if interpreter is available on host
    fn check_interpreter(&self, command: &str) -> Option<String> {
        // Use 'which' command to check availability
        let output = Command::new("which").arg(command).output().ok()?;

        if output.status.success() {
            String::from_utf8(output.stdout).ok().map(|s| s.trim().to_string())
        } else {
            None
        }
    }

    /// Get interpreter version
    fn get_version(&self, command: &str, version_flag: &str) -> Option<String> {
        let output = Command::new(command)
            .arg(version_flag)
            .output()
            .ok()?;

        String::from_utf8(output.stdout)
            .ok()
            .or_else(|| String::from_utf8(output.stderr).ok())
            .map(|s| s.lines().next().unwrap_or("unknown").to_string())
    }

    /// Run with bubblewrap if available, otherwise return Unsupported
    fn run_with_bwrap(
        &self,
        interpreter: &str,
        _script_path: &Path,
    ) -> Result<RunnerVerdict> {
        // Check if bubblewrap is available
        let bwrap_available = Command::new("which")
            .arg("bwrap")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if !bwrap_available {
            return Ok(RunnerVerdict::Unsupported {
                reason: format!(
                    "Interpreter '{}' found but bubblewrap not available for sandboxing",
                    interpreter
                ),
            });
        }

        // TODO: Implement full bubblewrap sandbox with:
        // - Read-only bind of script directory
        // - Private /tmp
        // - No network (--unshare-net)
        // - Seccomp filter
        // For now, return Unsupported to avoid security issues

        Ok(RunnerVerdict::Unsupported {
            reason: format!(
                "{} found on host. Bubblewrap sandbox needs implementation.\n\
                 Future: rustpython.wasm / quickjs.wasm will remove this dependency.",
                interpreter
            ),
        })
    }
}

impl Default for InterpreterRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl Runner for InterpreterRunner {
    fn can_handle(&self, class: &FileClass) -> bool {
        matches!(
            class,
            FileClass::Python
                | FileClass::JavaScript
                | FileClass::TypeScript
                | FileClass::Ruby
                | FileClass::Php
                | FileClass::Perl
                | FileClass::Lua
                | FileClass::Shell
                | FileClass::PowerShell
                | FileClass::R
                | FileClass::Swift
                | FileClass::Kotlin
                | FileClass::Scala
        )
    }

    fn execute(
        &self,
        _path: &Path,
        _classification: &ClassificationResult,
        mode: SecurityMode,
    ) -> Result<RunnerVerdict> {
        crate::cage::sandbox::validate_file_size(_path)?;

        let config = self
            .get_config_for_class(&_classification.class)
            .context("No interpreter config for file class")?;

        // Check if interpreter is available
        let interpreter_path = self.check_interpreter(config.command);

        if let Some(path_str) = interpreter_path {
            // Log interpreter invocation
            let version = self.get_version(config.command, config.version_flag);

            tracing::info!(
                "InterpreterRunner: {} at {:?} (version: {:?})",
                config.command,
                path_str,
                version
            );

            // --- PRE-EXECUTION SOURCE SCAN GATE ---
            // This runs BEFORE any fork() or spawn. Even if Landlock/Seccomp
            // degrades, this layer catches dangerous patterns at the text level.
            // GATE 7: log before returning verdict.
            let request_id = uuid::Uuid::new_v4();
            let source = match std::fs::read_to_string(_path) {
                Ok(s) => s,
                Err(e) => {
                    return Ok(RunnerVerdict::Blocked {
                        reason: format!("Failed to read script source for gate scan: {}", e),
                    });
                }
            };

            let policy = SecurityPolicy::new(mode);
            if let Some(violation) = policy.scan_source(&source) {
                crate::cage::log_intercept(
                    crate::cage::Severity::High,
                    "EXECUTE_BLOCKED",
                    &format!("[PRE-EXEC GATE] {}", violation),
                    request_id,
                );
                return Ok(RunnerVerdict::Blocked { reason: violation });
            }
            // --- END SOURCE SCAN GATE ---

            // Set up ephemeral workspace
            let workspace_buf = crate::socket::config::sandbox_workspace_dir();
            let workspace = workspace_buf.as_path();
            if let Err(e) = std::fs::create_dir_all(workspace) {
                return Ok(RunnerVerdict::Blocked {
                    reason: format!("Failed to create workspace: {}", e),
                });
            }

            let abs_path = std::path::Path::new(_path)
                .canonicalize()
                .unwrap_or_else(|_| std::path::PathBuf::from(_path));

            // Execute inside kernel sandbox (Landlock → Seccomp → Cgroups)
            let sandbox_opts = SandboxOptions::default();

            let mut sandbox_cmd = Command::new(&path_str);
            sandbox_cmd
                .arg(&abs_path)
                .current_dir(workspace)
                .env_clear()                    // strip all env vars
                .env("HOME", workspace)         // fake home = workspace only
                .env("TMPDIR", workspace)
                .env("RUST_LOG", "off")         // silence child tracing logs
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            let child = match spawn_sandboxed_command(sandbox_cmd, workspace, sandbox_opts, mode) {
                Ok(c) => c,
                Err(e) => {
                    return Ok(RunnerVerdict::Blocked {
                        reason: format!("Sandbox spawn failed: {}", e),
                    });
                }
            };

            let output = match child.wait_with_output() {
                Ok(out) => out,
                Err(e) => {
                    return Ok(RunnerVerdict::Blocked {
                        reason: format!("Failed to collect sandbox output: {}", e),
                    });
                }
            };

            // Capture output — filter internal SANDBOX log lines
            let stdout_raw = String::from_utf8_lossy(&output.stdout).to_string();
            let stdout = stdout_raw
                .lines()
                .filter(|line| !line.contains("sandbox::cage::sandbox")
                    && !line.contains("INFO sandbox::")
                    && !line.contains("WARN sandbox::")
                    && !line.contains("ERROR sandbox::"))
                .collect::<Vec<_>>()
                .join("\n");
            let stdout = if stdout.is_empty() { stdout_raw } else { stdout + "\n" };
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);

            crate::cage::sandbox::check_process_status(output.status);

            let combined_output = if !stderr.is_empty() {
                format!("STDOUT:\n{}\nSTDERR:\n{}", stdout, stderr)
            } else {
                stdout.clone()
            };

            // Log execution event
            // Gate 7: ScriptExecuted event
            crate::cage::log_intercept(
                crate::cage::Severity::Medium,
                "SCRIPT_EXECUTED",
                &format!(
                    "Executed {} script at {}. Exit code: {}",
                    config.command,
                    _path.display(),
                    exit_code
                ),
                request_id,
            );

            if output.status.success() {
                Ok(RunnerVerdict::Success { output: stdout })
            } else {
                Ok(RunnerVerdict::Blocked {
                    reason: format!("Script failed with code {}:\n{}", exit_code, combined_output),
                })
            }
        } else {
            // Interpreter not found
            Ok(RunnerVerdict::Unsupported {
                reason: format!(
                    "{} not found on host. Install {} to execute this file.\n\
                     Future: rustpython.wasm / quickjs.wasm will remove this dependency.",
                    config.command, config.command
                ),
            })
        }
    }

    fn check_dependencies(&self) -> Vec<DependencyStatus> {
        self.configs
            .iter()
            .map(|c| {
                let available = self.check_interpreter(c.command).is_some();
                let path = self.check_interpreter(c.command);
                let version = if available {
                    self.get_version(c.command, c.version_flag)
                } else {
                    None
                };

                DependencyStatus {
                    name: c.command.to_string(),
                    available,
                    version,
                    path,
                }
            })
            .collect()
    }
}

// TODO: seccomp-bpf hardening — see docs/SECCOMP_PLAN.md
// cfg(target_os = "linux")
// fn apply_seccomp_profile(_policy: &SeccompPolicy) -> Result<()> {
//     todo!("seccomp-bpf implementation pending WSL2/Linux verification")
// }
//
// Placeholder for seccomp policy structure
// pub struct SeccompPolicy {
//     allowed_syscalls: Vec<&'static str>,
//     denied_syscalls: Vec<&'static str>,
// }
