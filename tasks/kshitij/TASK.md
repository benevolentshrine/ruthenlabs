# Backend & Model Benchmarks — Task for Kshitij

## Overview

You own the **orchestrator backend** — the brains of UNIT-01. Three areas:

1. **Model benchmarking** — Which models work best? How fast? How accurate? Create a test harness.
2. **Socket system** — The Unix Domain Socket (UDS) mesh that connects orchestrator ↔ sandbox ↔ indexer. Make it reliable, traceable, and monitored.
3. **Backend robustness** — LLM client, streaming parser, MCP integration, error recovery, session management.

## Current State

### Code Structure

```
orchestrator/src/
├── main.rs            → Entrypoint: boots model, spawns daemons, launches UI
├── socket.rs          → UDS listener (orchestrator.sock), NDJSON-based sibling IPC
├── types.rs           → Message, OllamaMessage, OllamaRequest, Directive
├── schema.rs          → JSON schema for structured output (directive enum)
├── clients/
│   ├── mod.rs
│   ├── uds.rs         → UDS client for talking to sandbox/indexer
│   ├── sandbox.rs     → Sandbox client wrapper
│   └── indexer.rs     → Indexer client wrapper
├── llm_client.rs      → Ollama HTTP client (show, stream, chat)
├── stream_parser.rs   → Streaming chunk parser with thinking block extraction
├── model_profile.rs   → Model profile loading (context window, params, capabilities)
├── mcp.rs             → MCP tool registry (spawns MCP servers, calls tools)
├── executor.rs        → Tool execution orchestrator
├── daemon.rs          → Daemon lifecycle manager (spawn/kill sandbox & indexer)
├── hardware.rs        → System RAM detection
├── history.rs         → Chat history persistence
├── workspace.rs       → Workspace directory management
├── auto_context.rs    → Auto context window sizing
├── markdown.rs        → Markdown rendering
├── review.rs          → Code review integration
├── session.rs         → Session management
└── ui.rs              → Terminal UI (iocraft-based)

```

---

## Task 1: Model Benchmark Harness

### Why

The orchestrator currently hardcodes a single model at startup (`UNIT01_MODEL` env var, default `qwen2.5-coder:3b`). We need to know:
- Which models produce valid structured JSON (directive schema)?
- Which models are fast enough for interactive use?
- Which models are good at code generation vs chat vs reasoning?
- What context window, parameter size, and capabilities does each model advertise?

### What to Build

Create `orchestrator/benches/` with a benchmark harness:

#### `benches/model_bench.rs`

```
Tests per model:

1. Schema compliance — Can the model output valid structured JSON matching
   the directive_schema()? Send a prompt and check directives are parseable.
   → Metric: schema_valid_rate (%), malformed_json_rate (%)

2. Latency — Time to first token, tokens per second, total response time
   at different context lengths (1K, 4K, 8K, 16K tokens).
   → Metric: ttft_ms, tok_per_sec, total_ms

3. Instruction following — Does the model follow the system prompt?
   Test with known inputs and check correct tool selection.
   → Metric: correct_tool_rate (%), hallucinated_tool_rate (%)

4. Context utilization — How much context does the model actually use?
   vs how much it advertises.
   → Metric: usable_ctx vs advertised_ctx

5. Thinking support — Does the model emit  thinking tags?
   Can we extract them cleanly?
   → Metric: thinking_parseable (bool), avg_thinking_tokens
```

#### Output Format

Save results to `benchmarks/results/{model_name}.json`:

```json
{
  "model": "qwen2.5-coder:7b",
  "timestamp": "2026-05-27T12:00:00Z",
  "hardware": { "ram_gb": 32, "cpu": "Apple M4" },
  "profile": {
    "family": "qwen2",
    "parameter_size": "7.6B",
    "context_window": 32768
  },
  "results": {
    "schema_compliance": {
      "trials": 50,
      "valid": 48,
      "valid_rate": 0.96,
      "avg_malformed": "..."
    },
    "latency": {
      "avg_ttft_ms": 320,
      "avg_tok_per_sec": 45.2,
      "avg_total_ms": 4200,
      "by_context_length": {
        "1k": { "ttft_ms": 150, "tok_per_sec": 52 },
        "8k": { "ttft_ms": 480, "tok_per_sec": 38 }
      }
    }
  }
}
```

#### Models to Benchmark (Minimum)

```
qwen2.5-coder:0.5b     → smallest, for testing
qwen2.5-coder:1.5b     → ultra-fast
qwen2.5-coder:3b       → default in code
qwen2.5-coder:7b       → balanced
qwen2.5-coder:14b      → quality (if hardware allows)
qwen2.5-coder:32b      → maximum (if hardware allows)
deepseek-coder-v2      → alternative family
llama3.1:8b            → alternative family
codegemma:7b           → alternative family
```

### Benchmark CLI

Add a CLI subcommand to the orchestrator:

```bash
# Run all benchmarks
cargo run --release -- benchmark --all

# Run a specific model
cargo run --release -- benchmark --model qwen2.5-coder:7b

# Run specific test
cargo run --release -- benchmark --model qwen2.5-coder:7b --test latency

# Output directory
cargo run --release -- benchmark --all --output ./benchmarks/results
```

---

## Task 2: Socket System Reliability

### Current State

The UDS socket system exists but is bare-bones:

- `socket.rs` — Single listener on `/tmp/ruthen/orchestrator.sock`. Reads NDJSON lines. Links to sibling services (sandbox, indexer).
- `clients/uds.rs` — Client for connecting to sibling sockets.
- `clients/sandbox.rs` — Wrapper around sandbox socket calls.
- `clients/indexer.rs` — Wrapper around indexer socket calls.

### Problems to Fix

| Problem | Current Behavior | Desired Behavior |
|---|---|---|
| Connection drops | Lost messages, no reconnect | Exponential backoff reconnect (max 5 retries) |
| No heartbeat | Dead siblings not detected | Ping/pong every 5 seconds |
| No metrics | No visibility into socket health | Track bytes sent/received, msg count, errors |
| Single-threaded listener | All siblings share one acceptor | Per-sibling dedicated handler |
| No message delivery guarantee | Fire-and-forget | At-least-once delivery with ACK |
| Stale socket file | Crash on restart if old socket exists | Clean up on startup, LOCK file |

### What to Build

#### 1. Socket Manager (`socket_manager.rs`)

A new module that wraps the raw UDS with:

```rust
pub struct SocketManager {
    // Track all sibling connections
    siblings: HashMap<String, SiblingConnection>,
    // Message stats
    metrics: Arc<Mutex<SocketMetrics>>,
}

pub struct SiblingConnection {
    name: String,            // "sandbox", "indexer"
    socket_path: PathBuf,
    state: ConnectionState,  // Connected, Reconnecting, Dead
    reconnect_count: u32,
    last_heartbeat: Instant,
    tx: mpsc::Sender<SocketMessage>,
}

pub struct SocketMetrics {
    pub msgs_sent: u64,
    pub msgs_received: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
    pub reconnects: u64,
    pub errors: u64,
    pub last_error: Option<String>,
    pub uptime_seconds: u64,
}
```

#### 2. Heartbeat System

```
Orchestrator ──ping──> Sandbox
Sandbox ──pong──> Orchestrator

If no pong in 5s → log warning
If no pong in 15s → mark sibling as Dead
If marked Dead → try reconnect every 2s, 4s, 8s, 16s, 32s (then stop)
```

#### 3. Socket CLI Debug Tool

```bash
# Check socket health
cargo run -- socket status
# Output:
#   orchestrator: /tmp/ruthen/orchestrator.sock  ✓ online (5m12s uptime)
#   sandbox:      /tmp/ruthen/sandbox.sock        ✓ online (5m10s uptime)
#   indexer:      /tmp/ruthen/indexer.sock        ✓ online (5m11s uptime)
#
#   Metrics:
#     msgs_sent: 1,234  |  msgs_received: 1,198
#     bytes_sent: 892KB |  bytes_received: 1.1MB
#     reconnects: 0     |  errors: 2 (last: timeout on sandbox ping)

# View real-time message flow
cargo run -- socket monitor
# Shows live NDJSON messages flowing between services

# Gracefully restart a sibling
cargo run -- socket restart sandbox
```

#### 4. Protocol Upgrade

The current NDJSON protocol is too basic. Wrap it with a lightweight frame:

```
Frame format (binary-safe):
┌─────────────────────────────────────────────┐
│ Magic: 0x5255 ("RU")                        │ 2 bytes
│ Version: 0x01                               │ 1 byte
│ Type: 0x01 (data) / 0x02 (ping) / 0x03 (ack)│ 1 byte
│ Sequence: u32 (big-endian)                  │ 4 bytes
│ Payload length: u32 (big-endian)            │ 4 bytes
│ Payload: JSON bytes                         │ N bytes
│ ─────────────────────────────────────────── │
│ Total header: 12 bytes                      │
└─────────────────────────────────────────────┘
```

This allows:
- Reliable delivery (sequence numbers, ACKs)
- Binary-safe transport (no JSON parsing ambiguity)
- Built-in health checks (ping/pong types)
- Out-of-order detection (sequence gaps)

---

## Task 3: Backend Robustness

### 3.1 LLM Client Improvements

Current `llm_client.rs` only supports Ollama at `http://127.0.0.1:11434`.

Add multi-provider support:

```rust
pub enum LLMProvider {
    Ollama { endpoint: String },
    OpenAI { api_key: String, model: String },
    Anthropic { api_key: String, model: String },
}
```

The `LLMClient` trait should abstract over providers:
- Same `stream_directives()` interface
- Same `chat()` interface
- Same `stream_cli()` interface

Implementation order:
1. Extract `LLMClient` into a trait
2. Keep `OllamaClient` as-is (rename)
3. Add `OpenAIClient` (uses OpenAI-compatible API)
4. Add `AnthropicClient` (uses Anthropic API)

Each provider should support:
- `/api/show` equivalent (model metadata)
- Streaming chat
- Structured output (JSON mode or tool use)

### 3.2 Streaming Parser Hardening

Current `stream_parser.rs` has basic thinking block extraction. Known edge cases:

- [ ] Empty thinking blocks: `  `
- [ ] Nested thinking: `  inner ` — should NOT parse, just show as text
- [ ] Unclosed thinking: `  rest of text` — should close at end of stream
- [ ] Multiple thinking blocks in one response
- [ ] Thinking blocks at end of stream (no trailing newline)
- [ ] Extremely long thinking blocks (>10K tokens) — truncate gracefully
- [ ] Control characters in thinking blocks
- [ ] Unicode/emoji in thinking blocks
- [ ] Streaming: partial ` ` across chunk boundaries — must buffer

### 3.3 Session Persistence

Current `session.rs` should save/restore full session state:

```rust
pub struct PersistentSession {
    session_id: String,
    created_at: DateTime<Utc>,
    messages: Vec<Message>,
    model: String,
    workspace: String,
    tool_registry: Vec<String>,
    token_usage: TokenUsage,
}
```

- Save to `~/.local/share/ruthen/sessions/{session_id}.json`
- `session list` — show all sessions
- `session load {id}` — resume a session
- `session delete {id}` — remove a session
- Auto-save every N messages (configurable, default 5)

### 3.4 Error Recovery

The orchestrator currently panics on many errors. Add fallbacks:

| Error | Current | Desired |
|---|---|---|
| Ollama not running | Panic | Retry 3 times with 5s delay, then show friendly error |
| Sandbox MCP not found | Crash | Log warning, run in degraded mode (no sandbox) |
| Indexer socket missing | Crash | Run in degraded mode (no file search) |
| JSON parse error in stream | Skip chunk | Log + count + skip, don't crash |
| Network timeout | Panic | Retry with backoff, then return error to user |

---

## Task 4: Model Profile Database

The `model_profile.rs` currently hardcodes capabilities per parameter count. Instead, build a **model database** that knows about every model:

Create `orchestrator/src/models/`:

```rust
// models/registry.rs
pub struct ModelRegistry {
    models: HashMap<String, ModelRecord>,
}

pub struct ModelRecord {
    pub name: String,
    pub family: String,
    pub parameter_size: String,
    pub parameters_b: f64,
    pub context_window: u64,
    pub capabilities: ModelCapabilities,
    pub recommended_config: ModelConfig,
}

pub struct ModelCapabilities {
    pub thinking: bool,
    pub structured_output: bool,
    pub tool_use: bool,
    pub vision: bool,
    pub code_specialist: bool, // fine-tuned for code
}
```

Seed with known models (from benchmarks). The benchmark script should also output model records that can be merged into this registry.

---

## Success Criteria

- [ ] `cargo bench` runs model benchmarks and outputs JSON results
- [ ] Benchmarks cover at least 5 models across latency, schema compliance, instruction following
- [ ] Socket monitor shows real-time message flow
- [ ] Socket auto-reconnect works (kill sandbox → wait → it reconnects)
- [ ] Multi-provider LLM client works with Ollama + at least one remote provider
- [ ] Session save/restore roundtrip works
- [ ] Graceful degradation when sandbox/indexer are offline
- [ ] All existing tests pass + new tests for socket manager and model registry

---

---

## Task 5: VM Testing (Linux)

### 5.1 Provision a Linux VM

Same setup as the sandbox-mcp task — use Lima, OrbStack, or Vagrant:

```bash
# Lima (recommended on macOS)
brew install lima
limactl create template://ubuntu-24.04 --name ruthen-test
limactl shell ruthen-test
```

Inside the VM:
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
```

### 5.2 What to Test in the VM

#### A. Model benchmarks (requires Ollama running in VM)
```bash
# Inside VM: install Ollama
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5-coder:0.5b   # smallest, fast pull for testing

# Run benchmarks
cd /ruthen-labs
cargo run --release -- benchmark --all --output /tmp/bench_results
```

Test these on real Linux:
- Multiple concurrent LLM requests
- Streaming parser with real Ollama output
- Thinking block extraction from real model responses
- JSON structured output compliance

#### B. Socket system load testing
```bash
# Start daemons
./target/debug/sandbox daemon &
./target/debug/orchestrator --headless &

# Run socket stress test
# Send 1000 messages in rapid succession, verify no dropped messages
# Kill sandbox mid-stream, verify orchestrator reconnects gracefully
```

#### C. Session persistence
```bash
# Start orchestrator, have a conversation, save session
# Kill orchestrator, restart, load session
# Verify messages, model, and token usage are restored
```

#### D. File descriptors and resource limits
```bash
# Run with ulimit -n 64 (very low FD limit)
# Verify graceful degradation instead of crash
ulimit -n 64
./target/debug/orchestrator --headless
```

#### E. Network resilience
```bash
# Kill Ollama while orchestrator is running
# Verify retry with backoff, then human-friendly error
# Restart Ollama, verify orchestrator auto-recovers

# Test network timeout: set LLM_ENDPOINT to a slow/fake server
LLM_ENDPOINT=http://localhost:9999 ./target/debug/orchestrator --headless
# Expected: "Could not reach Ollama at http://localhost:9999 — is it running?"
```

### 5.3 Performance Profiling in VM

```bash
# Measure orchestrator startup time
hyperfine './target/debug/orchestrator --headless --exit'

# Measure memory usage under load
/usr/bin/time -v ./target/debug/orchestrator --headless &
# Run a 100-message conversation, check max RSS

# CPU profiling with perf (Linux-only)
perf record -F 99 -g ./target/debug/orchestrator --headless --exit
perf report
```

---

## Task 6: CI/CD Pipeline

### 6.1 GitHub Actions

Add to orchestrator section in `.github/workflows/ci.yml`:

```yaml
  benchmark:
    runs-on: ubuntu-latest
    services:
      ollama:
        image: ollama/ollama:latest
        ports:
          - 11434:11434
        volumes:
          - ollama-models:/root/.ollama
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: |
          # Wait for Ollama to be ready
          for i in $(seq 30); do
            curl -s http://localhost:11434/api/tags && break
            sleep 2
          done
          # Pull test model
          ollama pull qwen2.5-coder:0.5b
      - run: cargo run --release -- benchmark --model qwen2.5-coder:0.5b --output /tmp/bench_results
      - uses: actions/upload-artifact@v4
        with:
          name: benchmark-results
          path: /tmp/bench_results

  socket-stress:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: sudo apt-get install -y pkg-config libssl-dev
      - run: cargo build --release
      - name: Integration socket test
        run: |
          # Start sandbox daemon
          ./target/release/sandbox daemon &
          SANDBOX_PID=$!
          sleep 1
          
          # Start orchestrator
          UNIT01_MODEL=llama3.2:1b \
          ./target/release/orchestrator --headless &
          ORCH_PID=$!
          sleep 2
          
          # Send test messages over UDS
          echo '{"msg_type":"request","service":"sandbox","payload":{}}' | \
            nc -U /tmp/ruthen/orchestrator.sock
          
          # Kill sandbox, test reconnect
          kill $SANDBOX_PID
          sleep 5
          # Re-start sandbox
          ./target/release/sandbox daemon &
          sleep 3
          # Verify orchestrator auto-reconnected
          
          # Cleanup
          kill $ORCH_PID 2>/dev/null || true
          kill %2 2>/dev/null || true
```

### 6.2 Pre-commit Hook

Same as sandbox-mcp — ensure tests pass before committing:

```bash
#!/bin/bash
set -euo pipefail
cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

### 6.3 Benchmark Dashboard (Future)

Save benchmark results to `benchmarks/results/` and create a simple HTML dashboard:

```bash
# Run benchmarks
cargo run --release -- benchmark --all

# Generate dashboard
cargo run --release -- benchmark dashboard --input ./benchmarks/results

# Opens: benchmarks/dashboard.html
# Shows: model comparison table, latency graphs, schema compliance rates
```

Visual:
```
Model               | Tok/s | TTFT | Schema% | Thinking | Params
────────────────────┼───────┼──────┼─────────┼──────────┼───────
qwen2.5-coder:0.5b  │ 89.2  │ 42ms │ 78.0%   │ ✗        │ 0.5B
qwen2.5-coder:3b    │ 45.1  │ 121ms│ 94.0%   │ ✗        │ 3B
qwen2.5-coder:7b    │ 28.7  │ 320ms│ 96.0%   │ ✗        │ 7B
deepseek-coder-v2   │ 22.3  │ 450ms│ 98.0%   │ ✓        │ 16B
```

---

## Task 7: Orchestrator Test Coverage

### 7.1 Unit Test Targets

Add `#[cfg(test)]` modules to these currently-untested files:

| File | What to test |
|---|---|
| `llm_client.rs` | Request serialization, response parsing, error handling |
| `stream_parser.rs` | All thinking block edge cases (see Task 3.2) |
| `model_profile.rs` | Profile detection, model resolution |
| `session.rs` | Save/load roundtrip, session listing, deletion |
| `schema.rs` | Schema generation, validation |
| `types.rs` | Message serialization, directive parsing |
| `mcp.rs` | Tool discovery, tool calling, error handling |
| `socket_manager.rs` | (new module) Reconnect, heartbeat, metrics |
| `executor.rs` | Tool execution flow, error recovery |
| `daemon.rs` | Subprocess spawn/kill, lifecycle |

### 7.2 Integration Test Targets

Create `orchestrator/tests/`:

| Test file | What it tests |
|---|---|
| `tests/socket_integration.rs` | Spawn orchestrator + sandbox, communicate over UDS |
| `tests/llm_integration.rs` | Connect to real Ollama, stream a response, parse directives |
| `tests/session_persistence.rs` | Save session, restart, restore, verify state |
| `tests/mcp_integration.rs` | Spawn sandbox-mcp, call tools, verify results |
| `tests/benchmark_output.rs` | Run benchmarks, verify JSON output format |

---

## Current Files

| File | Purpose |
|---|---|
| `orchestrator/src/main.rs` | Entrypoint — boot sequence |
| `orchestrator/src/socket.rs` | Current UDS listener |
| `orchestrator/src/llm_client.rs` | Ollama HTTP client |
| `orchestrator/src/stream_parser.rs` | Streaming JSON parser |
| `orchestrator/src/model_profile.rs` | Model capability detection |
| `orchestrator/src/mcp.rs` | MCP tool registry |
| `orchestrator/src/daemon.rs` | Subprocess lifecycle |
| `orchestrator/src/session.rs` | Session management |
| `orchestrator/src/clients/uds.rs` | UDS client library |
| `orchestrator/src/clients/sandbox.rs` | Sandbox IPC |
| `orchestrator/src/clients/indexer.rs` | Indexer IPC |
