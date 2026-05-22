# Ruthen Labs PRO — Enterprise & Compliance Features

These features are stripped from the open-core UNIT-01 to keep it lean, fast, and
focused on the core "vibe coding" experience. They are available in the PRO
tier for enterprise customers who need compliance, auditing, and threat detection.

---

## Sandbox PRO Features

### WASM Cage (`runner/wasm.rs`)
Wasmitme-based WebAssembly sandbox with fuel budget, 64MB memory ceiling, and
deny-by-default WASI. Over-engineered for the core use case — the Interpreter
and Binary runners handle real development tools via Landlock+Seccomp.

### Archive Runner (`runner/archive.rs`)
Recursively extracts ZIP/TAR/GZ/RAR/7z/ISO/DEB/RPM archives and feeds each
file back through the classifier. Useful for enterprise code review pipelines.

### Scanner Runner (`runner/scanner.rs`)
Static analysis for documents and media (PDF JavaScript, Office macros, magic
byte verification) without executing anything. Compliance requirement for
security-conscious enterprises.

### Directory Scanner (`scanner/`)
Recursive directory scanner that classifies every file, runs entropy + hash
checks, and generates severity reports (Clean/Suspicious/Critical/KnownBad).

### Entropy Scanner (`scanner/entropy.rs`)
Shannon entropy detection for packed/obfuscated/encrypted files. Flags
high-entropy content as suspicious (threshold ≥7.2 critical). Causes false
positives on minified frontend builds (Vite, Webpack) — excluded from open-core.

### Hash Database (`threat/`)
Offline SHA-256 malware hash lookup against a local `hashdb.json`. Fully
offline, no cloud API. Unnecessary for open-core since the agent builds fresh
code rather than downloading known malware.

### Tamper-Evident Audit Log (`intercept/audit.rs`)
SHA256 hash chain over audit entries (`seq|timestamp|event|verdict|prev_hash`).
`log --verify` checks chain integrity. Enterprise compliance feature — solo
developers don't need blockchain logging on their laptop.

### Quarantine (`intercept/quarantine.rs`)
Blocked files are moved to `/tmp/ruthenlabs/quarantine/` with metadata.json.
Enterprise incident response feature.

### Pre-Execution Gate (`cage/gate.rs`)
YAML-based policy file that validates tool-call categories before each fork().
Adds latency and permission popup friction. Landlock + Seccomp handle this
natively at the syscall level in open-core.

### TUI Dashboard (`tui/`)
Ratatui-based terminal UI for monitoring the cage, viewing logs, and managing
execution. The product is moving to a Next.js/Ink-based TUI — this is legacy.

### Watchdog (`watchdog/`)
Real-time file monitoring using `notify`. Watches directories continuously and
auto-scans new files. Creates disk thrashing during builds — open-core uses
on-demand scanning instead.

### Full 5-Mode Policy System (`cage/policy.rs`)
Hard/Mid/Easy/Custom/Audit security modes. Open-core uses a single invisible
guardian mode (Lock/Run/Root via `set_policy`).

---

## Indexer PRO Features

### BLAKE3 File Hashing (`hasher/`)
Hashes every indexed file's contents. Unnecessary for open-core — the indexer
searches by filename and content (ripgrep), not by content hash.

### File Watcher (`watcher.rs`)
Real-time incremental re-indexing via `notify`. Causes disk thrashing during
builds. Open-core re-indexes on-demand when the user submits a prompt.

### Output Formatters (`output.rs`)
JSON and NDJSON formatting for query results. Open-core returns results over
JSON-RPC — formatting is the client's responsibility.

---

## Orchestrator PRO Features

### Session Manager (`session.go`)
Save, load, and resume chat sessions from `~/.ruthen/unit01/sessions/`.
Useful for enterprise audit trails and handoff scenarios.

---

## How PRO Features Are Compiled

The open-core binary excludes these modules entirely. PRO features are compiled
with:

```bash
cargo build --features pro  # Sandbox/Indexer
go build -tags pro          # Orchestrator
```
