#!/usr/bin/env bun
// ── Unit-01 entry point ──────────────────────────────────────────────

import { App } from './app.js'
import { registerBuiltinCommands } from './commands/builtins.js'
import { ensureDaemons, IndexerClient, SandboxClient } from './daemons/lifecycle.js'
import { OllamaClient } from './llm/ollama.js'

// Register slash commands
registerBuiltinCommands()

async function main() {
  // Handle CLI flags
  const args = process.argv.slice(2)

  // --help / -h
  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  // --version / -v
  if (args.includes('--version') || args.includes('-v')) {
    console.log('unit01 0.1.0')
    process.exit(0)
  }

  // --model <name>
  const modelIdx = args.indexOf('--model')
  if (modelIdx !== -1) {
    const m = args[modelIdx + 1]
    if (m) {
      const { saveSettings } = await import('./config/store.js')
      saveSettings({ model: m })
    }
  }

  // Non-interactive: -p "prompt"
  const pIdx = args.indexOf('-p')
  if (pIdx !== -1) {
    const prompt = args[pIdx + 1]
    if (!prompt) {
      console.error('Error: -p requires a prompt argument')
      process.exit(2)
    }
    await runNonInteractive(prompt, args)
    return
  }

  // Interactive mode
  const app = new App()
  process.on('SIGINT', () => { app.cleanup(); process.exit(0) })
  process.on('SIGTERM', () => { app.cleanup(); process.exit(0) })

  try {
    await app.run()
    process.exit(0)
  } catch (e) {
    console.error('Fatal:', e)
    process.exit(1)
  }
}

async function runNonInteractive(prompt: string, args: string[]) {
  const { loadSettings } = await import('./config/store.js')
  const settings = loadSettings()
  if (!settings.model) {
    console.error('Error: --model <name> or /model required for non-interactive mode')
    process.exit(2)
  }
  let indexer: IndexerClient, sandbox: SandboxClient
  try {
    const d = await ensureDaemons()
    indexer = d.indexer
    sandbox = d.sandbox
  } catch (e: any) {
    console.error('Error: failed to start daemons:', e?.message ?? e)
    process.exit(2)
  }
  const ollama = new OllamaClient(settings.ollamaUrl)
  if (!(await ollama.checkConnection())) {
    console.error(`Error: Ollama not reachable at ${settings.ollamaUrl}`)
    process.exit(2)
  }
  const ctx = await ollama.getContextLength(settings.model).catch(() => 8192)

  const { loadProjectContext } = await import('./config/store.js')
  const cwd = settings.workingDir || process.cwd()
  const projectContext = loadProjectContext(cwd)
  const systemPrompt = `You are UNIT-01, a local code assistant running on the user's machine.

Working directory: ${cwd}

You have access to a set of tools for reading, writing, and analyzing code, and for running shell commands. Use them.

# Working principles
- **Investigate before acting.** Use read_file, search_code, find_files to understand existing code before changing it.
- **Make minimal, targeted edits.** Prefer patch_file over write_file when modifying existing files. Use write_file only for new files or full rewrites.
- **Check blast radius.** Before editing a shared module, call find_dependents or impact_analysis.
- **Show your work.** Briefly state what you're doing and why.
- **Verify.** After writes/patches, run relevant tests or commands via run_command.

# Tool use rules
- Use read_file with start_line/end_line for large files to avoid loading everything.
- search_code uses BM25; use specific, distinctive terms. semantic_search for concepts.
- patch_file requires the target text to appear EXACTLY ONCE in the file. If unsure, read the file first.
- run_command runs in a kernel-isolated sandbox. Network is denied by default. Build/test/git commands are encouraged.
- For multi-step tasks, plan briefly, then execute. Use run_command to verify.

# Style
- Be concise. Skip pleasantries.
- Use markdown: \`code\`, **bold**, lists, code blocks.
- If you don't know or the user needs to choose, ask. Don't guess.

${projectContext ? `# Project Context\n${projectContext}` : ''}`

  const { AgenticExecutor } = await import('./llm/executor.js')
  const executor = new AgenticExecutor({
    model: settings.model,
    mode: 'auto',
    indexer,
    sandbox,
    systemPrompt,
    contextWindow: ctx,
  })

  const messages = [{ id: 'p1', role: 'user' as const, content: prompt, timestamp: Date.now() }]

  for await (const ev of executor.run(
    messages,
    async () => 'allow',
    async () => 'accept',
  )) {
    if (ev.type === 'tool_text') process.stdout.write(ev.text)
    if (ev.type === 'tool_error') console.error('\n[error]', ev.error)
    if (ev.type === 'done') process.stdout.write('\n')
  }
}

function printHelp() {
  console.log(`unit01 — local AI coding assistant

Usage:
  unit01                  Start interactive TUI
  unit01 -p "prompt"      Run a single prompt and exit (non-interactive)
  unit01 --model <name>   Set the default model
  unit01 --help           Show this help
  unit01 --version        Show version

In the TUI:
  Enter            submit
  Shift+Tab        cycle permission mode (plan/ask/auto-edit/auto/yolo)
  ↑/↓              history (when input empty) or scroll (in chat)
  PgUp/PgDn        scroll chat
  Mouse wheel      scroll chat
  ?                help
  Ctrl+C           quit

Slash commands:
  /help, /init, /model, /mode, /doctor, /index, /shadow, /undo,
  /deps, /impact, /compress, /clear, /save, /resume, /quit
`)
}

main().catch(e => { console.error(e); process.exit(1) })
