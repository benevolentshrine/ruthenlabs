# UNIT-01 — Orchestrator TUI

A local-only TUI frontend for UNIT-01 daemons. Routes file operations to the indexer and shell execution to the sandbox over UDS. Uses Ollama as the LLM provider.

## Quick Start

### 1. Prerequisites

- **Node.js 18+**
- **Ollama** running locally (`ollama serve`)
- At least one model pulled (`ollama pull qwen3.5:2b` or any other)
- **Optional:** Indexer + Sandbox daemons running (for file ops and shell execution)

### 2. Install & Launch

```bash
cd unit-01/orchestrator
npm install
node src/index.mjs
```

### 3. Set a Model

On first launch, no model is selected. Use the slash commands:

```
/models       → list models available in your Ollama
/model <name> → switch to that model (e.g. /model qwen3.5:2b)
```

### 4. Try It

Type any prompt. The model will reply immediately. File ops (read, write, edit, glob, grep, ls) and shell commands (bash) only work if the indexer and sandbox daemons are running on their default sockets.

## Slash Commands (Essentials)

| Command | What it does |
|---|---|
| `/help` | List all commands |
| `/models` | Show models available in Ollama |
| `/model <name>` | Switch model |
| `/fast` | Toggle fast/slow model |
| `/clear` | Clear conversation |
| `/compact` | Compact context (saves tokens) |
| `/doctor` | Check system health |
| `/status` | Show session info |
| `/config` | Show current configuration |
| `/plan` | Toggle plan mode (read-only) |
| `/undo` | Undo last file edit |
| `/diff` | Show git diff |
| `/commit` | Commit with AI message |
| `/quit` or `/exit` | Exit |

## Config

Set these environment variables if needed:

```bash
export OLLAMA_HOST=http://localhost:11434    # default, change if different
export OLLAMA_MODEL=qwen3.5:2b               # default model at startup
```

Or set them in `v2/src/config/settings.mjs`.

## Daemon Socket Paths

| Service | Socket |
|---|---|
| Indexer | `/tmp/ruthen/indexer.sock` |
| Sandbox | `/tmp/ruthen/sandbox.sock` |

## File Structure

```
orchestrator/
  src/
    index.mjs               ← entry point
    ui/                     ← TUI (React/Ink)
    ui/commands/            ← slash commands
      essential.mjs         ← core commands (loaded by default)
      auxiliary.mjs         ← peripheral commands
      archive.mjs           ← dead-weight commands
    tools/                  ← 25 tools, 7 wired to UDS
    core/
      agent-loop.mjs        ← agent loop + Ollama caller
      providers.mjs         ← Ollama-only provider config
    utils/
      udsClient.mjs         ← UDS JSON-RPC 2.0 client
```

## Troubleshooting

**"model is required" error:**
Set a model first: `/models` to see what's available, then `/model <name>`.

**"Connection refused" on tools:**
Indexer or sandbox not running. File and shell tools will error but the chat works fine without them.

**"Raw mode not supported" error:**
Expected in non-TTY environments. Run in a real terminal.
