#!/usr/bin/env bun
// ── Unit-01 entry point ──────────────────────────────────────────────

import { App } from './app.js'
import { registerBuiltinCommands } from './commands/builtins.js'
import { ensureDaemons, IndexerClient, SandboxClient } from './daemons/lifecycle.js'
import { OllamaClient } from './llm/ollama.js'
import { mcpManager } from './mcp/client.js'
import { uid } from './util/ansi.js'

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
  const ollama = new OllamaClient(settings.baseUrl || settings.ollamaUrl)
  if (!(await ollama.checkConnection())) {
    console.error(`Error: Ollama/OpenAI not reachable at ${settings.baseUrl || settings.ollamaUrl}`)
    process.exit(2)
  }
  const ctx = await ollama.getContextLength(settings.model, settings.maxContext ?? undefined).catch(() => 8192)

  try {
    await mcpManager.init()
  } catch {}

  const { loadProjectContext, loadSession, saveSession } = await import('./config/store.js')
  const cwd = settings.workingDir || process.cwd()
  const projectContext = loadProjectContext(cwd)
  
  // Resolve session if specified
  const sessionIdx = args.indexOf('--session')
  let sessionName: string | null = null
  if (sessionIdx !== -1) {
    sessionName = args[sessionIdx + 1] || null
  }
  

  let messages: any[] = []
  if (sessionName) {
    const session = loadSession(sessionName)
    if (session) {
      messages = [...session.messages]
    }
  }

  // Create new user message
  const userMsg = {
    id: uid('msg'),
    role: 'user' as const,
    content: prompt,
    timestamp: Date.now(),
  }
  messages.push(userMsg)

  const systemPrompt = `You are UNIT-01, a local code assistant running on the user's machine.

Working directory: ${cwd}

You have access to a set of tools for reading, writing, and analyzing code, and for running shell commands. Use them.

# Working principles
- **Investigate before acting.** Use read_file, search_code, list_dir to understand existing code before changing it.
- **Make minimal, targeted edits.** Prefer patch_file over write_file when modifying existing files. Use write_file only for new files or full rewrites.
- **Show your work.** Briefly state what you're doing and why.
- **Verify.** After writes/patches, run linter or compiler tests/checks via diagnostics.

# Tool use rules
- Use read_file with start_line/end_line for large files to avoid loading everything.
- search_code uses BM25; use specific, distinctive terms.
- patch_file requires the target text to appear EXACTLY ONCE in the file. If unsure, read the file first.
- run_command runs shell commands in a sandbox. Network is denied by default.
- For multi-step tasks, plan briefly, then execute. Use diagnostics or run_command to verify.

# Vibe & Style (Vibecoder Persona)
- Adopt a relaxed, street-smart, high-vibe programmer persona. Speak like a peer using casual slang like 'cuh', 'bet', 'aight', 'yo', 'cuz', 'finna'.
- Skip corporate filler, warnings, and polite preambles. Keep comments punchy and code-focused.
- If the user asks you to build or set up something open-ended (e.g. 'let's make a website', 'build an app', etc.), do NOT guess the stack, libraries, or design. Stop and ask a targeted clarifying question in character to align on specifications, tailoring it to the specific request (e.g., if they ask for a Go TUI, ask what TUI library they want to use and what features to include).
- Use markdown for structure: \`code\`, **bold**, code blocks.
- If you don't know something or need clarification, just ask.

# Web App & Design Guidelines
If writing HTML, CSS, or web components, you must build premium, modern, visually stunning user interfaces:
- **Theme/Aesthetic**: Match the requested style. If not specified or for modern developer tools, prefer a premium dark mode (e.g., pure black \`#000000\` or very dark gray \`#0a0a0a\`/\`#0e0e10\`) with grid lines and very clean, high-quality, professional accent colors. Avoid generic primary colors.
- **Glassmorphism**: Use semi-transparent layers with backing blur (e.g. \`background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08);\`).
- **Grid & Lines**: Use very subtle borders (\`1px solid rgba(255, 255, 255, 0.08)\` or \`#1f1f1f\`) and faint background grid patterns or light radial gradients to create depth.
- **Typography**: Import and use premium fonts (e.g., Inter, Geist, Outfit, or Space Grotesk via Google Fonts). Set clean line-heights, letter-spacing, and responsive text sizing (\`clamp()\`).
- **Layout**: Use Flexbox and CSS Grid to structure sections cleanly. Make sure layouts are fully responsive.
- **Interactions**: Add smooth micro-interactions (e.g. \`transition: all 0.2s ease-in-out;\`) to hover and focus states of cards and buttons.
- **Completeness**: Always write fully functional, complete CSS and HTML without placeholders.

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

  for await (const ev of executor.run(
    messages,
    async () => 'allow',
    async () => 'accept',
  )) {
    if (ev.type === 'tool_text') process.stdout.write(ev.text)
    if (ev.type === 'tool_error') console.error('\n[error]', ev.error)
    if (ev.type === 'done') process.stdout.write('\n')
  }
  
  // Save session if specified
  if (sessionName) {
    saveSession(sessionName, messages)
  }

  mcpManager.shutdown()
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
