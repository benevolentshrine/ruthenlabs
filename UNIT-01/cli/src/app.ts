// ── App: top-level state machine ─────────────────────────────────────

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { TUI } from './ui/tui.js'
import { ansi, colors, uid, vw, pad, trunc, stripAnsi, SPINNER } from './util/ansi.js'
import { fmtBytes, fmtNumber } from './util/format.js'
import { renderStatusBar, renderHeader } from './ui/widgets/status-bar.js'
import { renderPermissionModal } from './ui/widgets/permission.js'
import { renderToolsPanel } from './ui/widgets/tool-card.js'
import { renderDiffModal } from './ui/widgets/diff-modal.js'
import { renderHelp } from './ui/views/help.js'
import { renderMenuModal, renderDoctorModal } from './ui/views/slash-menu.js'
import { renderBootView, type BootViewState } from './ui/views/boot.js'
import { renderFiglet } from './ui/widgets/logo.js'
import { ChatView, parseThoughts, formatDuration } from './ui/views/chat.js'
import { InputField } from './ui/widgets/input.js'
import { MenuController } from './ui/menu/controller.js'
import { TabCompleter } from './ui/autocomplete/completer.js'
import type {
  AppState, ChatMessage, ToolCall, PermissionMode, ModelInfo,
  PendingPermission, PermissionDecision, PendingDiff, DaemonState
} from './types.js'
import { IndexerClient, SandboxClient } from './daemons/lifecycle.js'
import { OllamaClient } from './llm/ollama.js'
import { AgenticExecutor, type ToolEvent } from './llm/executor.js'
import { loadSettings, saveSettings, loadProjectContext, loadHistory, saveHistoryItem, listSessions, loadSession, saveSession } from './config/store.js'
import { matchCommands } from './commands/registry.js'
import { mcpManager } from './mcp/client.js'

export interface AppContext {
  state: AppState
  colors: typeof colors
  ansi: typeof ansi
  indexer: IndexerClient
  sandbox: SandboxClient
  showHelp(): void
  hideHelp(): void
  requestModelPicker(): void
  setModel(m: string): void
  setMode(m: PermissionMode): void
  enterChatWithModel(m: string): Promise<void>
  notify(level: 'info' | 'warn' | 'error' | 'success' | 'dim' | 'tool', message: string): void
  clearMessages(): void
  saveSession(name: string): void
  resumeSession(name: string): boolean
  listSessions(): ReturnType<typeof listSessions>
  quit(): void
  compress(): Promise<number>
  promptForFile(): Promise<string | null>
  showDoctor(lines: string[]): void
}

interface HelpMenuItem {
  category?: string
  name?: string
  cmd?: string
  shortcut?: string
}

const HELP_ITEMS: HelpMenuItem[] = [
  { category: 'Suggested' },
  { name: 'Switch session', cmd: '/resume', shortcut: '/resume' },
  { name: 'Switch model', cmd: '/model', shortcut: '/model' },
  { category: 'Session' },
  { name: 'Switch session', cmd: '/resume', shortcut: '/resume' },
  { name: 'New session', cmd: '/new', shortcut: '/new' },
  { name: 'Save session', cmd: '/save', shortcut: '/save' },
  { name: 'Clear messages', cmd: '/clear', shortcut: '/clear' },
  { category: 'Agent' },
  { name: 'Switch model', cmd: '/model', shortcut: '/model' },
  { name: 'Cycle mode', cmd: '/mode', shortcut: 'shift+tab' },
  { name: 'Toggle thinking', cmd: '/thinking', shortcut: '/thinking' },
  { name: 'Rebuild index', cmd: '/index', shortcut: '/index' },
  { name: 'Find dependencies', cmd: '/deps', shortcut: '/deps' },
  { name: 'Impact analysis', cmd: '/impact', shortcut: '/impact' },
  { category: 'System' },
  { name: 'Doctor (status)', cmd: '/doctor', shortcut: '/doctor' },
  { name: 'Rollback writes', cmd: '/undo', shortcut: '/undo' },
  { name: 'List backups', cmd: '/shadow', shortcut: '/shadow' },
  { name: 'Compress history', cmd: '/compress', shortcut: '/compress' },
  { name: 'Exit app', cmd: '/exit', shortcut: '/exit' }
]

function getFilteredHelpItems(q: string): HelpMenuItem[] {
  if (!q) return HELP_ITEMS
  
  const filtered: HelpMenuItem[] = []
  for (let i = 0; i < HELP_ITEMS.length; i++) {
    const item = HELP_ITEMS[i]
    if (item.category !== undefined) {
      // Look ahead to see if any items in this category match the query
      let hasMatch = false
      for (let j = i + 1; j < HELP_ITEMS.length; j++) {
        const next = HELP_ITEMS[j]
        if (next.category !== undefined) break
        if (next.name?.toLowerCase().includes(q) || next.cmd?.toLowerCase().includes(q)) {
          hasMatch = true
          break
        }
      }
      if (hasMatch) {
        filtered.push(item)
      }
    } else {
      if (item.name?.toLowerCase().includes(q) || item.cmd?.toLowerCase().includes(q)) {
        filtered.push(item)
      }
    }
  }
  return filtered
}

export class App {
  tui: TUI
  state: AppState
  indexer!: IndexerClient
  sandbox!: SandboxClient
  ollama!: OllamaClient
  executor: AgenticExecutor | null = null
  chatView: ChatView
  input: InputField
  context: AppContext
  history: string[] = []
  historyIdx: number = -1
  currentStreamAbort: AbortController | null = null
  bootState: BootViewState | null = null
  allModels: ModelInfo[] = []
  menuController: MenuController
  tabCompleter: TabCompleter
  running = true
  doctorInfo: string[] | null = null
  private lastWarnedThreshold = 0
  private lastMenuLinesCount = 0
  private lastCursorRow = 0

  constructor() {
    this.tui = new TUI()
    this.state = {
      view: 'boot',
      model: null,
      mode: 'ask',
      workingDir: process.cwd(),
      messages: [],
      streaming: false,
      streamingText: '',
      currentToolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      contextWindow: 8192,
      indexerState: 'connecting',
      sandboxState: 'connecting',
      status: 'Initializing...',
      pendingPermission: null,
      pendingDiff: null,
      palette: null,
      helpOpen: false,
      modelPicker: null,
    }
    this.chatView = new ChatView()
    this.input = new InputField({
      onSubmit: (text) => this.onSubmit(text),
      onChange: (text) => this.onInputChange(text),
      onSlashCommand: (cmd) => this.onSlashCommand(cmd),
      onTab: (text, cursor) => this.onTab(text, cursor),
      onHistoryUp: () => this.historyPrev(),
      onHistoryDown: () => this.historyNext(),
    })
    this.menuController = new MenuController()
    this.tabCompleter = new TabCompleter(() => this.indexer, this.input)
    this.input.setPlaceholder('Ask anything... "What is the tech stack of this project?"')
    this.context = {
      state: this.state,
      colors,
      ansi,
      indexer: this.indexer!,  // set later
      sandbox: this.sandbox!,
      showHelp: () => { this.state.helpOpen = true; this.scheduleRender() },
      hideHelp: () => { this.state.helpOpen = false; this.scheduleRender() },
      requestModelPicker: () => {
        // Open inline picker overlay (not the boot screen)
        if (this.allModels.length === 0) {
          this.notify('error', 'No models available. Is Ollama running?')
          return
        }
        const currentIdx = this.allModels.findIndex(m => m.name === this.state.model)
        this.state.modelPicker = { index: currentIdx >= 0 ? currentIdx : 0 }
        this.scheduleRender()
      },
      setModel: (m) => { this.state.model = m; this.state.view = 'chat'; this.executor = this.makeExecutor(); saveSettings({ model: m }); this.scheduleRender() },
      setMode: (m) => { this.state.mode = m; this.executor?.setMode(m); saveSettings({ mode: m }); this.scheduleRender() },
      enterChatWithModel: (m) => this.setModelAndEnter(m),
      notify: (lvl, msg) => this.notify(lvl, msg),
      clearMessages: () => {
        this.state.messages = []
        this.chatView.state.messages = []
        this.state.tokensIn = 0
        this.state.tokensOut = 0
        this.lastWarnedThreshold = 0
        this.input.setPlaceholder('Ask anything... "What is the tech stack of this project?"')
        this.scheduleRender()
      },
      saveSession: (n) => saveSession(n, this.state.messages),
      resumeSession: (n) => { const s = loadSession(n); if (!s) return false; this.state.messages = s.messages; this.chatView.state.messages = s.messages; this.scheduleRender(); return true },
      listSessions,
      quit: () => { this.running = false },
      compress: () => this.compress(),
      promptForFile: () => this.promptForFile(),
      showDoctor: (lines) => { this.doctorInfo = lines; this.scheduleRender() },
    }
  }

  makeExecutor() {
    return new AgenticExecutor({
      model: this.state.model!,
      mode: this.state.mode,
      indexer: this.indexer,
      sandbox: this.sandbox,
      systemPrompt: this.makeSystemPrompt(),
      contextWindow: this.state.contextWindow,
    })
  }

  // Set the model AND fetch its context length, transitioning to chat view.
  // Used by both the boot screen picker (legacy) and the inline /model picker.
  async setModelAndEnter(name: string) {
    this.state.model = name
    this.state.view = 'chat'
    this.bootState = null
    const settings = loadSettings()
    try {
      this.state.contextWindow = await this.ollama.getContextLength(name, settings.maxContext ?? undefined) || 8192
    } catch {}
    this.executor = this.makeExecutor()
    saveSettings({ model: name, contextWindow: this.state.contextWindow })
    this.notify('success', `Model: ${name} (${fmtNumber(this.state.contextWindow)} ctx)`)
    this.scheduleRender()
  }

  makeSystemPrompt(): string {
    const cwd = this.state.workingDir
    const projectContext = loadProjectContext(cwd)
    return `You are UNIT-01, a local code assistant running on the user's machine.

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
- **Theme/Aesthetic**: Match the requested style. If not specified or for modern developer tools, prefer a premium dark mode (e.g., pure black \`#000000\` or very dark gray \`#0a0a0a\`/\`#0e0e10\`) with crisp white text and very clean, high-quality, professional accent colors (like neon purple, teal, or amber). Avoid generic, flat primary colors.
- **Glassmorphism**: Use semi-transparent layers with backing blur (e.g. \`background: rgba(255, 255, 255, 0.03); backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.08);\`).
- **Grid & Lines**: Use very subtle borders (\`1px solid rgba(255, 255, 255, 0.08)\` or \`#1f1f1f\`) and faint background grid patterns or light radial gradients to create depth.
- **Typography**: Import and use premium fonts (e.g., Inter, Geist, Outfit, or Space Grotesk via Google Fonts). Set clean line-heights, letter-spacing, and responsive text sizing (\`clamp()\`).
- **Layout**: Use Flexbox and CSS Grid to structure sections cleanly. Make sure layouts are fully responsive.
- **Interactions**: Add smooth micro-interactions (e.g. \`transition: all 0.2s ease-in-out;\`) to hover and focus states of cards and buttons.
- **Completeness**: Always write fully functional, complete CSS and HTML without placeholders.${projectContext ? `\n\n# Project Context\n${projectContext}` : ''}`
  }

  async start() {
    this.tui.enter()
    this.tui.onRender(() => this.render())
    this.tui.onResize(() => this.render())
    this.tui.onKey((k) => { void this.onKey(k) })

    this.history = loadHistory()

    // Boot
    this.state.view = 'chat'
    this.bootState = {
      models: [],
      index: 0,
      ollamaRunning: true,
      indexerRunning: false,
      sandboxRunning: false,
      workingDir: this.state.workingDir,
      projectInfo: null,
      loading: true,
      model: this.state.model,
    }

    // Print welcome mascot panel once at startup
    const welcomeBlock = this.chatView.buildWelcomeBlock(this.tui.getSize().cols)
    for (const l of welcomeBlock.lines) {
      process.stdout.write(l + '\n')
    }
    process.stdout.write('\n')

    this.scheduleRender()

    // Initialize in parallel
    await this.boot()
  }

  async boot() {
    const settings = loadSettings()
    this.state.mode = settings.mode
    this.state.contextWindow = settings.contextWindow
    this.state.workingDir = settings.workingDir

    // Ollama check
    const llmUrl = settings.baseUrl || settings.ollamaUrl
    this.ollama = new OllamaClient(llmUrl)
    this.bootState!.ollamaRunning = await this.ollama.checkConnection()
    if (!this.bootState!.ollamaRunning) {
      this.notify('error', `LLM runtime not reachable at ${llmUrl}. Ensure your LLM server (Ollama/LM Studio/Jan) is running.`)
      this.render()
      
      const interval = setInterval(() => {
        if (!this.running || this.state.view !== 'boot' || (this.bootState && this.bootState.ollamaRunning)) {
          clearInterval(interval)
          return
        }
        if (this.bootState) {
          this.bootState.index = (this.bootState.index + 1) % 4
          this.scheduleRender()
        }
      }, 250)

      return
    }

    // Models
    try {
      const models = await this.ollama.listModels()
      this.allModels = models.map(m => ({
        name: m.name,
        size: m.size,
        family: m.details?.family ?? 'unknown',
        parameterSize: m.details?.parameter_size ?? '?',
        quantization: m.details?.quantization_level ?? '?',
        modifiedAt: m.modified_at,
      }))
      this.bootState!.models = this.allModels
      this.bootState!.loading = false
      this.bootState!.model = this.state.model
      if (settings.model && this.allModels.find(m => m.name === settings.model)) {
        this.bootState!.index = this.allModels.findIndex(m => m.name === settings.model)
      } else if (this.allModels.length > 0) {
        this.bootState!.index = 0
      }
    } catch (e: any) {
      this.notify('error', `Failed to list models: ${e?.message ?? e}`)
      this.bootState!.loading = false
    }

    // Daemons
    try {
      const { indexer, sandbox } = await import('./daemons/lifecycle.js').then(m => m.ensureDaemons())
      this.indexer = indexer
      this.sandbox = sandbox
      this.state.indexerState = 'connected'
      this.state.sandboxState = 'connected'
      this.bootState!.indexerRunning = true
      this.bootState!.sandboxRunning = true
      this.context.indexer = indexer
      this.context.sandbox = sandbox
    } catch (e: any) {
      this.notify('error', `Daemon start failed: ${e?.message ?? e}`)
    }

    // MCP initialization
    try {
      await mcpManager.init()
      const mcpToolsCount = mcpManager.getTools().length
      if (mcpToolsCount > 0) {
        this.notify('success', `Loaded ${mcpToolsCount} MCP tools`)
      }
    } catch (e: any) {
      this.notify('error', `MCP initialization failed: ${e?.message ?? e}`)
    }

    // Project info
    try {
      const r = await this.indexer.glob('**/*', this.state.workingDir)
      this.bootState!.projectInfo = { files: r.files.length, lines: 0 }
    } catch {}

    // Load saved model if available and valid
    if (settings.model && this.allModels.find(m => m.name === settings.model)) {
      this.state.model = settings.model
      try {
        this.state.contextWindow = await this.ollama.getContextLength(settings.model, settings.maxContext ?? undefined) || settings.contextWindow || 8192
      } catch {
        this.state.contextWindow = settings.contextWindow || 8192
      }
    }

    this.state.view = 'chat'
    if (this.state.model) {
      this.executor = this.makeExecutor()
    } else {
      this.context.requestModelPicker()
    }
    this.bootState = null

    this.input.setValue('/')
    this.onInputChange('/')

    this.render()
  }

  returnToSlashMenu() {
    this.menuController.activeMenu = 'commands'
    this.menuController.menuOptions = matchCommands('/')
    this.menuController.menuIndex = 0
    this.input.setValue('/')
    this.scheduleRender()
  }

  // ── Key handling ──────────────────────────────────────────────
  async onKey(key: any): Promise<boolean> {
    // Doctor overlay
    if (this.doctorInfo !== null) {
      if (key.name === 'escape' || key.name === 'enter' || key.name === 'q') {
        this.doctorInfo = null
        this.returnToSlashMenu()
        return true
      }
      return true
    }

    // Help overlay
    if (this.state.helpOpen) {
      if (key.name === 'escape' || key.name === 'q' || key.name === '?') {
        this.state.helpOpen = false
        this.returnToSlashMenu()
        return true
      }
      return true
    }

    // Model picker overlay
    if (this.state.modelPicker) {
      if (key.name === 'escape') {
        this.state.modelPicker = null
        this.returnToSlashMenu()
        return true
      }
      if (key.name === 'up') {
        this.state.modelPicker.index = Math.max(0, this.state.modelPicker.index - 1)
        this.scheduleRender()
        return true
      }
      if (key.name === 'down') {
        this.state.modelPicker.index = Math.min(this.allModels.length - 1, this.state.modelPicker.index + 1)
        this.scheduleRender()
        return true
      }
      if (key.name === 'enter' && this.allModels.length > 0) {
        const m = this.allModels[this.state.modelPicker.index]
        this.state.modelPicker = null
        await this.setModelAndEnter(m.name)
        return true
      }
      return true
    }

    // Permission modal
    if (this.state.pendingPermission) {
      if (key.name === 'y' || key.name === 'enter') {
        this.resolvePermission('allow')
        return true
      }
      if (key.name === 'n' || key.name === 'escape') {
        this.resolvePermission('deny')
        return true
      }
      if (key.name === 'a') {
        this.resolvePermission('always')
        return true
      }
      return true
    }

    // Diff modal
    if (this.state.pendingDiff) {
      if (key.name === 'y' || key.name === 'enter') {
        this.resolveDiff('accept')
        return true
      }
      if (key.name === 'n' || key.name === 'escape') {
        this.resolveDiff('reject')
        return true
      }
      return true
    }

    // Global keys
    if (key.ctrl && key.name === 'c') {
      if (this.state.streaming) { this.currentStreamAbort?.abort(); return true }
      this.running = false
      this.cleanup()
      process.exit(0)
    }
    if (key.ctrl && key.name === 'l') {
      this.state.messages = []
      this.chatView.state.messages = []
      this.scheduleRender()
      return true
    }
    if (key.name === 'escape' && this.state.streaming) {
      this.currentStreamAbort?.abort()
      return true
    }

    // Boot view (welcome screen — passive, just listens for Enter or /model)
    if (this.state.view === 'boot') {
      if (key.name === 'enter') {
        if (this.state.model) {
          // Saved model exists — jump straight to chat
          this.state.view = 'chat'
          if (!this.executor) this.executor = this.makeExecutor()
          this.scheduleRender()
        } else if (this.allModels.length > 0) {
          // No model — open the inline picker
          this.context.requestModelPicker()
        }
        return true
      }
      if (key.name === 'q' || key.name === 'escape') {
        this.running = false
        this.cleanup()
        process.exit(0)
      }
      if (key.name === '?' || key.name === 'h') {
        this.state.helpOpen = true
        this.scheduleRender()
        return true
      }
      if (key.name === 'r') {
        // retry boot (re-discover daemons + models)
        if (this.bootState) this.bootState.loading = true
        this.scheduleRender()
        await this.boot()
        return true
      }
      return true
    }

    // Chat view
    if (this.state.view === 'chat') {
      // Dropdown menu key handling
      if (this.menuController.isActive()) {
        if (await this.menuController.handleKey(key, this.context, this.input, this.allModels, (c) => this.onSlashCommand(c))) {
          this.scheduleRender()
          return true
        }
      }

      // Shift+Tab = cycle mode
      if (key.name === 'tab' && key.shift) {
        const order: PermissionMode[] = ['plan', 'ask', 'auto-edit', 'auto', 'yolo']
        const i = order.indexOf(this.state.mode)
        this.context.setMode(order[(i + 1) % order.length])
        this.notify('info', `Mode → ${this.state.mode}`)
        return true
      }
      if (key.name === '?' && !this.input.getValue()) {
        this.state.helpOpen = true
        this.scheduleRender()
        return true
      }
      if (key.name === 'pageup') {
        this.chatView.scrollUp(5)
        this.scheduleRender()
        return true
      }
      if (key.name === 'pagedown') {
        this.chatView.scrollDown(5)
        this.scheduleRender()
        return true
      }
      if (key.ctrl && key.name === 'o') {
        if (this.state.streaming && this.state.streamingText) {
          const { thought, isThinking } = parseThoughts(this.state.streamingText)
          if (thought && !isThinking) {
            this.chatView.toggleThought('streaming')
            this.scheduleRender()
            return true
          }
        }
        const messages = this.chatView.state.messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]
          if (m.role === 'assistant') {
            const { thought } = parseThoughts(m.content)
            if (thought) {
              this.chatView.toggleThought(m.id)
              this.scheduleRender()
              return true
            }
          }
        }
        return true
      }
      if (key.name === 'up' && this.input.getValue() === '' && this.chatView.canScrollUp) {
        this.chatView.scrollUp(1)
        this.scheduleRender()
        return true
      }
      if (key.name === 'down' && this.input.getValue() === '' && this.chatView.canScrollDown) {
        this.chatView.scrollDown(1)
        this.scheduleRender()
        return true
      }
      // Pass to input
      return await this.input.handleKey(key)
    }

    return false
  }

  onMouse(btn: number, x: number, y: number): boolean {
    if (btn === 64) { this.chatView.scrollUp(3); this.scheduleRender(); return true }
    if (btn === 65) { this.chatView.scrollDown(3); this.scheduleRender(); return true }
    if (btn === 0) {
      const msgId = this.chatView.thoughtHeaderRows.get(y)
      if (msgId) {
        this.chatView.toggleThought(msgId)
        this.scheduleRender()
        return true
      }
      const toolsKey = this.chatView.toolsHeaderRows.get(y)
      if (toolsKey) {
        this.chatView.toggleCollapse(toolsKey)
        this.scheduleRender()
        return true
      }
    }
    return false
  }

  // ── Submit / Slash ────────────────────────────────────────────
  async onSubmit(text: string) {
    if (!text.trim()) return
    saveHistoryItem(text)
    this.history.push(text)
    this.historyIdx = this.history.length

    this.input.setPlaceholder('')

    // Clear active input / menu from screen
    if (this.lastCursorRow > 0) {
      process.stdout.write(ansi.cursorUp(this.lastCursorRow))
    }
    process.stdout.write('\r' + ansi.clearLineDown)
    this.lastCursorRow = 0

    // Print permanent prompt
    process.stdout.write(`  ${ansi.fg(colors.asst)}❯${ansi.reset} ${text}\n\n`)

    const userMsg: ChatMessage = {
      id: uid('msg'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
    }
    this.state.messages.push(userMsg)
    this.chatView.appendMessage(userMsg)

    if (!this.executor || !this.state.model) {
      this.notify('error', 'No model selected. Use /model.')
      return
    }

    await this.runAgenticLoop()
  }

  async onSlashCommand(cmd: string): Promise<boolean> {
    const [name, ...rest] = cmd.split(/\s+/)
    const matches = matchCommands(name)
    if (matches.length === 0) {
      this.notify('error', `Unknown command: ${name}. Try /help.`)
      return true
    }
    const match = matches[0]
    // Find spec via the registry function
    const spec = (await import('./commands/registry.js')).findCommand(match.name)
    if (!spec) {
      this.notify('error', `Unknown command: ${name}`)
      return true
    }
    try {
      await spec.run(this.context, rest.join(' '))
    } catch (e: any) {
      this.notify('error', `Command failed: ${e?.message ?? e}`)
    }
    return true
  }

  onInputChange(text: string) {
    this.scheduleRender()
    
    if (this.state.view !== 'chat') {
      this.menuController.clear()
      return
    }
    
    this.menuController.onInputChange(text, this.allModels)
  }

  async onTab(text: string, cursor: number): Promise<{ items: string[]; apply: (s: string) => void } | null> {
    return await this.tabCompleter.onTab(text, cursor)
  }

  historyPrev(): string | null {
    if (this.history.length === 0) return null
    if (this.historyIdx > 0) this.historyIdx--
    return this.history[this.historyIdx]
  }

  historyNext(): string | null {
    if (this.history.length === 0) return null
    if (this.historyIdx < this.history.length - 1) {
      this.historyIdx++
      return this.history[this.historyIdx]
    }
    this.historyIdx = this.history.length
    return ''
  }

  async runAgenticLoop() {
    if (!this.executor) return
    this.state.streaming = true
    this.state.streamingText = ''
    this.state.currentToolCalls = []
    this.chatView.state.thoughtStartTime = Date.now()
    
    let wasThinking = false
    let prefixPrinted = false
    let lastToolLinesCount = 0

    const animInterval = setInterval(() => {
      if (!this.state.streaming) {
        clearInterval(animInterval)
        return
      }
      const { isThinking } = parseThoughts(this.state.streamingText)
      if (isThinking) {
        const elapsed = (Date.now() - this.chatView.state.thoughtStartTime) / 1000
        const durationStr = formatDuration(elapsed)
        const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]
        process.stdout.write(`\r\x1b[K  ${ansi.fg(colors.warn)}${spinner}${ansi.reset} ${ansi.fg(colors.textDim)}${ansi.dim}Thinking (${durationStr})...${ansi.reset}`)
      }
    }, 80)

    this.currentStreamAbort = new AbortController()

    try {
      const stream = this.executor.run(
        this.state.messages,
        async (pending) => this.requestPermission(pending),
        async (pending) => this.requestDiff(pending),
        (tool) => {
          this.updateToolCall(tool)
        }
      )
      for await (const ev of stream) {
        if (this.currentStreamAbort.signal.aborted) break
        switch (ev.type) {
          case 'tool_text': {
            this.state.streamingText += ev.text
            const { thought, response, isThinking } = parseThoughts(this.state.streamingText)
            if (isThinking) {
              wasThinking = true
              const elapsed = (Date.now() - this.chatView.state.thoughtStartTime) / 1000
              const durationStr = formatDuration(elapsed)
              const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]
              process.stdout.write(`\r\x1b[K  ${ansi.fg(colors.warn)}${spinner}${ansi.reset} ${ansi.fg(colors.textDim)}${ansi.dim}Thinking (${durationStr})...${ansi.reset}`)
            } else {
              if (wasThinking) {
                wasThinking = false
                process.stdout.write('\r\x1b[K')
                const elapsed = (Date.now() - this.chatView.state.thoughtStartTime) / 1000
                const durationStr = formatDuration(elapsed)
                process.stdout.write(`  ${ansi.fg(colors.textDim)}${ansi.dim}Thought for ${durationStr} (ctrl+o to expand)${ansi.reset}\n\n`)
                process.stdout.write(`  ${ansi.fg(colors.asst)}●${ansi.reset} `)
                prefixPrinted = true
                if (response) {
                  process.stdout.write(response)
                }
              } else {
                if (!prefixPrinted) {
                  process.stdout.write(`  ${ansi.fg(colors.asst)}●${ansi.reset} `)
                  prefixPrinted = true
                }
                process.stdout.write(ev.text)
              }
            }
            break
          }
          case 'tool_calls': {
            // Aggregate into the current assistant message
            const last = [...this.state.messages].reverse().find(m => m.role === 'assistant')
            if (last?.role === 'assistant' && last.toolCalls) {
              // Already pushed by executor
            }
            break;
          }
          case 'tool_start': {
            if (lastToolLinesCount > 0) {
              process.stdout.write(ansi.cursorUp(lastToolLinesCount) + '\r' + ansi.clearLineDown)
            }
            this.state.currentToolCalls.push(ev.tool)
            const cols = this.tui.getSize().cols
            const cardLines = renderToolsPanel('current', this.state.currentToolCalls, false, cols)
            process.stdout.write(cardLines.join('\n') + '\n')
            lastToolLinesCount = cardLines.length
            break
          }
          case 'tool_done': {
            this.updateToolCall(ev.tool)
            if (lastToolLinesCount > 0) {
              process.stdout.write(ansi.cursorUp(lastToolLinesCount) + '\r' + ansi.clearLineDown)
            }
            const cols = this.tui.getSize().cols
            const cardLines = renderToolsPanel('current', this.state.currentToolCalls, false, cols)
            process.stdout.write(cardLines.join('\n') + '\n')
            
            const allFinished = this.state.currentToolCalls.every(tc => tc.status !== 'running' && tc.status !== 'pending')
            if (allFinished) {
              lastToolLinesCount = 0
              this.state.currentToolCalls = []
              process.stdout.write('\n')
            } else {
              lastToolLinesCount = cardLines.length
            }
            break
          }
          case 'tokens': {
            this.state.tokensIn = ev.prompt
            this.state.tokensOut = ev.eval
            
            const totalTokens = this.state.tokensIn + this.state.tokensOut
            const pctUsed = this.state.contextWindow > 0 ? Math.round((totalTokens / this.state.contextWindow) * 100) : 0
            
            if (pctUsed >= 70) {
              const numCompressed = await this.compress()
              if (numCompressed > 0) {
                this.notify('success', `Auto-compressed context: cleared ${numCompressed} oldest messages.`)
              }
            } else {
              let currentThreshold = 0
              if (pctUsed >= 90) currentThreshold = 90
              else if (pctUsed >= 75) currentThreshold = 75

              if (currentThreshold > this.lastWarnedThreshold) {
                this.lastWarnedThreshold = currentThreshold
                if (currentThreshold === 90) {
                  this.notify('error', `Context limit critical (${pctUsed}%). Run /compress now or start a /new session to prevent model failure.`)
                } else if (currentThreshold === 75) {
                  this.notify('warn', `Context budget is getting full (${pctUsed}%). Consider running /compress to summarize history.`)
                }
              } else if (currentThreshold < this.lastWarnedThreshold) {
                this.lastWarnedThreshold = currentThreshold
              }
            }
            break
          }
          case 'done':
            if (wasThinking) {
              wasThinking = false
              process.stdout.write('\r\x1b[K')
            }
            this.commitAssistantMessage(this.state.streamingText, this.state.currentToolCalls)
            this.state.streamingText = ''
            this.state.currentToolCalls = []
            process.stdout.write('\n\n')
            break
          case 'aborted':
            if (wasThinking) {
              wasThinking = false
              process.stdout.write('\r\x1b[K')
            }
            this.commitAssistantMessage(this.state.streamingText + '\n\n[aborted]', this.state.currentToolCalls)
            this.state.streamingText = ''
            this.state.currentToolCalls = []
            process.stdout.write('\n\n[aborted]\n\n')
            break
          case 'tool_error':
            this.notify('error', ev.error)
            break
        }
      }
    } catch (e: any) {
      this.notify('error', `Stream error: ${e?.message ?? e}`)
    } finally {
      this.state.streaming = false
      this.currentStreamAbort = null
      this.scheduleRender()
    }
  }

  commitAssistantMessage(text: string, tools: ToolCall[]) {
    if (!text && tools.length === 0) return
    const last = [...this.state.messages].reverse().find(m => m.role === 'assistant')
    const finalDuration = (Date.now() - this.chatView.state.thoughtStartTime) / 1000
    if (last && last.role === 'assistant') {
      // Update the existing assistant message (it was created by executor)
      last.content = text
      last.toolCalls = tools.length > 0 ? tools : last.toolCalls
      last.thoughtDuration = finalDuration
    } else if (text) {
      const m: ChatMessage = {
        id: uid('msg'),
        role: 'assistant',
        content: text,
        toolCalls: tools.length > 0 ? tools : undefined,
        timestamp: Date.now(),
        thoughtDuration: finalDuration,
      }
      this.state.messages.push(m)
      this.chatView.appendMessage(m)
    }
  }

  updateToolCall(tc: ToolCall) {
    // Update the last assistant message's tool calls
    const last = [...this.state.messages].reverse().find(m => m.role === 'assistant')
    if (last?.role === 'assistant' && last.toolCalls) {
      const i = last.toolCalls.findIndex(t => t.id === tc.id)
      if (i >= 0) last.toolCalls[i] = tc
    }
    const idx = this.state.currentToolCalls.findIndex(t => t.id === tc.id)
    if (idx >= 0) this.state.currentToolCalls[idx] = tc
    
    this.chatView.updateToolCall(tc)
  }

  // ── Permissions / Diffs ─────────────────────────────────────
  requestPermission(p: PendingPermission): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      this.state.pendingPermission = { ...p, resolve }
      this.scheduleRender()
    })
  }

  resolvePermission(d: PermissionDecision) {
    if (!this.state.pendingPermission) return

    // Clear active permission block from screen
    if (this.lastCursorRow > 0) {
      process.stdout.write(ansi.cursorUp(this.lastCursorRow) + '\r' + ansi.clearLineDown)
    } else {
      process.stdout.write('\r' + ansi.clearLineDown)
    }
    this.lastCursorRow = 0

    const p = this.state.pendingPermission
    if (d === 'allow') {
      process.stdout.write(`  ${ansi.fg(colors.ok)}✓${ansi.reset} Permission allowed for tool: ${ansi.bold}${p.toolName}${ansi.reset}\n\n`)
    } else if (d === 'always') {
      process.stdout.write(`  ${ansi.fg(colors.ok)}✓${ansi.reset} Permission always allowed for tool: ${ansi.bold}${p.toolName}${ansi.reset}\n\n`)
    } else {
      process.stdout.write(`  ${ansi.fg(colors.error)}✗${ansi.reset} Permission denied for tool: ${ansi.bold}${p.toolName}${ansi.reset}\n\n`)
    }

    this.state.pendingPermission.resolve(d)
    this.state.pendingPermission = null
    this.scheduleRender()
  }

  requestDiff(d: PendingDiff): Promise<'accept' | 'reject' | 'edit'> {
    return new Promise<'accept' | 'reject' | 'edit'>((resolve) => {
      this.state.pendingDiff = { ...d, resolve }
      this.scheduleRender()
    })
  }

  resolveDiff(d: 'accept' | 'reject' | 'edit') {
    if (!this.state.pendingDiff) return

    // Clear active diff block from screen
    if (this.lastCursorRow > 0) {
      process.stdout.write(ansi.cursorUp(this.lastCursorRow) + '\r' + ansi.clearLineDown)
    } else {
      process.stdout.write('\r' + ansi.clearLineDown)
    }
    this.lastCursorRow = 0

    const p = this.state.pendingDiff
    if (d === 'accept') {
      process.stdout.write(`  ${ansi.fg(colors.ok)}✓${ansi.reset} Changes accepted for file: ${ansi.bold}${p.filePath}${ansi.reset}\n\n`)
    } else {
      process.stdout.write(`  ${ansi.fg(colors.error)}✗${ansi.reset} Changes rejected for file: ${ansi.bold}${p.filePath}${ansi.reset}\n\n`)
    }

    this.state.pendingDiff.resolve(d)
    this.state.pendingDiff = null
    this.scheduleRender()
  }

  // ── Notifications ──────────────────────────────────────────
  notify(level: 'info' | 'warn' | 'error' | 'success' | 'dim' | 'tool', message: string) {
    const map: Record<string, string> = {
      info:    `${ansi.fg(colors.unit)}ℹ${ansi.reset}`,
      warn:    `${ansi.fg(colors.warn)}⚠${ansi.reset}`,
      error:   `${ansi.fg(colors.error)}✗${ansi.reset}`,
      success: `${ansi.fg(colors.ok)}✓${ansi.reset}`,
      dim:     `${ansi.fg(colors.textMuted)} ${ansi.reset}`,
      tool:    `${ansi.fg(colors.tool)}⚙${ansi.reset}`,
    }
    const line = `${map[level]} ${message}`
    
    const sysMsg: ChatMessage = {
      id: uid('msg'),
      role: 'system',
      content: line,
      timestamp: Date.now(),
    }
    this.state.messages.push(sysMsg)

    // Clear active input / menu from screen
    const hadCursorRow = this.lastCursorRow
    if (hadCursorRow > 0) {
      process.stdout.write(ansi.cursorUp(hadCursorRow))
    }
    process.stdout.write('\r' + ansi.clearLineDown)
    this.lastCursorRow = 0

    process.stdout.write(`  ${line}\n\n`)

    this.scheduleRender()
  }

  async promptForFile(): Promise<string | null> {
    return new Promise((resolve) => {
      const oldInput = this.input
      const cb = (text: string) => {
        this.input = oldInput
        this.scheduleRender()
        resolve(text.trim() || null)
      }
      this.input = new InputField({
        onSubmit: cb,
        onChange: () => this.scheduleRender(),
        onSlashCommand: (c) => this.onSlashCommand(c),
        onHistoryUp: () => null,
        onHistoryDown: () => null,
      })
      this.input.setPlaceholder('file path...')
      this.scheduleRender()
    })
  }

  async compress(): Promise<number> {
    // Simple compression: keep last N messages, summarize older
    if (this.state.messages.length < 8) return 0
    const keep = 6
    const originalLen = this.state.messages.length
    const toCompress = originalLen - keep
    if (toCompress <= 0) return 0
    // Drop the oldest messages (we don't have a summary LLM call yet)
    this.state.messages = this.state.messages.slice(toCompress)
    this.chatView.state.messages = this.state.messages

    // Scale tokens down proportionally
    const ratio = keep / originalLen
    this.state.tokensIn = Math.round(this.state.tokensIn * ratio)
    this.state.tokensOut = Math.round(this.state.tokensOut * ratio)
    this.lastWarnedThreshold = 0

    return toCompress
  }

  // ── Render loop ────────────────────────────────────────────
  private renderPending = false
  private lastRenderTime = 0
  private static readonly MIN_FRAME_MS = 33  // ~30fps cap to prevent flooding
  scheduleRender() {
    if (this.renderPending) return
    this.renderPending = true
    const elapsed = Date.now() - this.lastRenderTime
    const wait = Math.max(0, App.MIN_FRAME_MS - elapsed)
    setTimeout(() => {
      this.renderPending = false
      this.lastRenderTime = Date.now()
      this.render()
    }, wait)
  }

  private drawWithBgPanel(content: string): string {
    // Replace all instances of reset (\x1b[0m) with reset + bg(bgPanel) (\x1b[0m\x1b[48;5;${colors.bgPanel}m)
    // so that background color is not cleared by resets within the text.
    const escaped = content.replace(/\x1b\[0m/g, `\x1b[0m\x1b[48;5;${colors.bgPanel}m`)
    return `${ansi.bg(colors.bgPanel)}${escaped}${ansi.reset}`
  }

  renderOnboarding(width: number, height: number): string[] {
    const lines: string[] = []
    
    // Figlet logo (centered)
    const logoLines = renderFiglet('UNIT-01', 15).split('\n')
    const logoWidth = 55
    const cx = Math.max(0, Math.floor((width - logoWidth) / 2))
    
    const boxWidth = Math.min(76, width - 8)
    const padX = Math.max(0, Math.floor((width - boxWidth) / 2))
    const borderCol = ansi.fg(colors.border)
    const reset = ansi.reset
    const accentBar = `${ansi.fg(colors.unit)}┃${reset}`
    
    // System messages / notifications if any (only on onboarding screen)
    const sysLines: string[] = []
    const sysMessages = this.state.messages.filter(m => m.role === 'system')
    if (sysMessages.length > 0) {
      const visibleSys = sysMessages.slice(-6)
      for (const m of visibleSys) {
        const content = m.content
        const w = vw(content)
        const x = Math.max(0, Math.floor((width - w) / 2))
        sysLines.push(' '.repeat(x) + content)
      }
    }
    
    // Calculate layout heights dynamically
    const sysHeight = sysLines.length > 0 ? (sysLines.length + 1) : 0
    const contentHeight = 16 + sysHeight
    const topPad = Math.max(1, Math.floor((height - contentHeight) / 2))
    
    for (let i = 0; i < topPad; i++) lines.push('')
    
    // Logo
    for (const l of logoLines) {
      lines.push(' '.repeat(cx) + l)
    }
    
    const logoSpacer = (sysLines.length > 0) ? 1 : 2
    for (let i = 0; i < logoSpacer; i++) lines.push('')
    
    // Render system messages / notifications
    if (sysLines.length > 0) {
      for (const sl of sysLines) {
        lines.push(sl)
      }
      lines.push('') // spacer
    }
    
    // Input box
    // Line 0: top padding (empty space)
    const padded0 = ' '.repeat(boxWidth - 1)
    const boxLine0 = ' '.repeat(padX) + accentBar + this.drawWithBgPanel(padded0)

    // Line 1 of the box: input field content
    const rawInputLines = this.input.renderRaw()
    const inputContent = rawInputLines[0] || ''
    const content1 = `  ${inputContent}`
    const padded1 = pad(content1, boxWidth - 1)
    const boxLine1 = ' '.repeat(padX) + accentBar + this.drawWithBgPanel(padded1)
    
    // Line 2: empty space
    const padded2 = ' '.repeat(boxWidth - 1)
    const boxLine2 = ' '.repeat(padX) + accentBar + this.drawWithBgPanel(padded2)
    
    // Line 3: status
    const modelName = this.state.model ?? '(no model selected)'
    const folderName = this.state.workingDir.split('/').pop() || 'workspace'
    const statusContent = `${ansi.fg(colors.mag)}${ansi.bold}Build${ansi.reset} ${ansi.fg(colors.textDim)}·${ansi.reset} ${ansi.fg(colors.text)}${modelName}${ansi.reset} ${ansi.fg(colors.textDim)}${folderName}`
    const content3 = `  ${statusContent}`
    const padded3 = pad(content3, boxWidth - 1)
    const boxLine3 = ' '.repeat(padX) + accentBar + this.drawWithBgPanel(padded3)

    // Line 4: bottom padding (empty space)
    const padded4 = ' '.repeat(boxWidth - 1)
    const boxLine4 = ' '.repeat(padX) + accentBar + this.drawWithBgPanel(padded4)
    
    lines.push(boxLine0)
    lines.push(boxLine1)
    lines.push(boxLine2)
    lines.push(boxLine3)
    lines.push(boxLine4)
    
    lines.push('')
    
    // Shortcuts hint line
    const hintText = `${ansi.fg(colors.textMuted)}/help${ansi.reset} commands`
    const hintLine = pad(hintText, boxWidth, 'right')
    lines.push(' '.repeat(padX) + hintLine)
    
    lines.push('')
    
    // Tip line
    const tipText = `${ansi.fg(colors.warn)}● Tip${ansi.reset} check ${ansi.fg(colors.unit)}doctor${ansi.reset} command to check status of indexer and sandbox (it helps)`
    const tipW = vw(tipText)
    const tipX = Math.max(0, Math.floor((width - tipW) / 2))
    lines.push(' '.repeat(tipX) + tipText)
    
    // Fill the rest
    while (lines.length < height - 1) lines.push('')
    
    // Bottom line empty space
    lines.push('')
    
    return lines
  }

  renderSidebar(width: number, height: number): string[] {
    const lines: string[] = []
    
    // Header / Title
    const firstUserMsg = this.state.messages.find(m => m.role === 'user')?.content ?? ''
    const sessionTitle = firstUserMsg
      ? trunc(firstUserMsg, width - 4)
      : 'Hey buddy'
      
    lines.push('') // spacer
    lines.push(`  ${ansi.bold}${ansi.fg(colors.user)}${sessionTitle}${ansi.reset}`)
    lines.push(`  ${ansi.fg(colors.border)}${'─'.repeat(width - 4)}${ansi.reset}`)
    lines.push('') // spacer
    
    // Context Info
    const totalTokens = this.state.tokensIn + this.state.tokensOut
    const pctUsed = this.state.contextWindow > 0 ? Math.round((totalTokens / this.state.contextWindow) * 100) : 0
    const pctColor = pctUsed >= 95 ? colors.error : pctUsed >= 80 ? colors.warn : colors.textDim
    lines.push(`  ${ansi.bold}${ansi.fg(colors.sys)}Context${ansi.reset}`)
    lines.push(`  ${ansi.fg(colors.textDim)}${fmtNumber(totalTokens)} tokens${ansi.reset}`)
    lines.push(`  ${ansi.fg(pctColor)}${pctUsed}% used${ansi.reset}`)
    lines.push(`  ${ansi.fg(colors.textDim)}$0.00 spent${ansi.reset}`)
    lines.push('')
    
    // LSP Info
    lines.push(`  ${ansi.bold}${ansi.fg(colors.sys)}LSP${ansi.reset}`)
    lines.push(`  ${ansi.fg(colors.textDim)}LSPs are disabled${ansi.reset}`)
    
    // Pad to height - 2
    while (lines.length < height - 2) {
      lines.push('')
    }
    
    // Path / Status
    const cwdBase = this.state.workingDir.split('/').pop() || '~'
    lines.push(`  /${cwdBase}`)
    
    const dot = `${ansi.fg(colors.ok2)}●${ansi.reset}`
    const modelName = this.state.model ? trunc(this.state.model, width - 6) : 'no model'
    lines.push(`  ${dot} ${ansi.bold}${ansi.fg(colors.mag)}${modelName}${ansi.reset}`)
    
    // Pad/Truncate all sidebar lines to exact width
    return lines.map(l => pad(l, width))
  }

  render() {
    if (!this.tui) return
    const { cols, rows } = this.tui.getSize()
    if (rows <= 0 || cols <= 0) return

    // Clear previous inline block from stdout
    if (this.lastCursorRow > 0) {
      process.stdout.write(ansi.cursorUp(this.lastCursorRow) + '\r' + ansi.clearLineDown)
      this.lastCursorRow = 0
    } else {
      process.stdout.write('\r' + ansi.clearLineDown)
    }

    // Determine layout widths
    const isFocused = !this.state.pendingPermission &&
                      !this.state.pendingDiff &&
                      !this.state.modelPicker &&
                      !this.menuController.isActive() &&
                      !this.doctorInfo &&
                      !this.state.helpOpen;
    if (isFocused) {
      this.input.focus()
    } else {
      this.input.blur()
    }

    const rawInputLines = this.input.render(cols)

    // Generate the divider/highlight bar line
    let barColor = colors.unit
    let modeText = this.state.mode.toUpperCase()
    
    if (this.state.streaming) {
      const { isThinking } = parseThoughts(this.state.streamingText)
      if (isThinking) {
        barColor = colors.warn
        modeText = 'THINKING'
      } else if (this.state.currentToolCalls.length > 0) {
        barColor = colors.warn
        modeText = 'RUNNING TOOL'
      } else {
        barColor = colors.asst
        modeText = 'RESPONDING'
      }
    } else {
      if (this.state.mode === 'plan') barColor = colors.textDim
      else if (this.state.mode === 'ask') barColor = colors.unit
      else if (this.state.mode === 'auto-edit') barColor = colors.ok
      else if (this.state.mode === 'auto') barColor = colors.warn
      else if (this.state.mode === 'yolo') barColor = colors.error
    }

    const modelName = this.state.model ? this.state.model.split('/').pop() || this.state.model : 'no model'
    const totalTokens = this.state.tokensIn + this.state.tokensOut
    const pctUsed = this.state.contextWindow > 0 ? Math.round((totalTokens / this.state.contextWindow) * 100) : 0
    const ctxText = `${pctUsed}% ctx`
    
    const leftPart = `── ${ansi.bold}${ansi.fg(barColor)}${modeText}${ansi.reset} ── ${ansi.bold}${modelName}${ansi.reset} ── ${ctxText} `
    const rawLeftLen = `── ${modeText} ── ${modelName} ── ${ctxText} `.length
    const rightDashesCount = Math.max(0, cols - rawLeftLen)
    const dividerBar = `${ansi.fg(colors.border)}${leftPart}${'─'.repeat(rightDashesCount)}${ansi.reset}`

    const inputLines = [dividerBar, ...rawInputLines]

    // Overlays (modals)
    let overlayLines: string[] = []
    if (this.state.helpOpen) {
      overlayLines = renderHelp(cols, rows)
    } else if (this.doctorInfo !== null) {
      overlayLines = renderDoctorModal(this.doctorInfo, cols, rows)
    } else if (this.state.pendingPermission) {
      overlayLines = renderPermissionModal(this.state.pendingPermission, cols, rows)
    } else if (this.state.pendingDiff) {
      overlayLines = renderDiffModal(this.state.pendingDiff, cols, rows)
    } else if (this.state.modelPicker) {
      overlayLines = renderMenuModal('model', this.allModels, this.state.modelPicker.index, cols, rows)
    } else if (this.menuController.isActive() && this.menuController.menuOptions.length > 0) {
      overlayLines = renderMenuModal(this.menuController.activeMenu!, this.menuController.menuOptions, this.menuController.menuIndex, cols, rows)
    }

    const totalLines = [...inputLines, ...overlayLines]
    process.stdout.write(totalLines.join('\n'))

    // Position cursor
    if (isFocused) {
      process.stdout.write(ansi.showCursor)
      const { row, col } = this.input.getCursorPos()
      // Adjust row offset by +1 because of dividerBar at index 0 of inputLines
      const moveUpCount = (totalLines.length - 1) - (row + 1)
      if (moveUpCount > 0) {
        process.stdout.write(ansi.cursorUp(moveUpCount))
      }
      process.stdout.write(`\r\x1b[${col + 1}G`)
      this.lastCursorRow = row + 1
    } else {
      process.stdout.write(ansi.hideCursor)
      this.lastCursorRow = totalLines.length - 1
    }
  }

  cleanup() {
    this.tui.exit()
    mcpManager.shutdown()
  }

  async run() {
    await this.start()
    // keep alive
    while (this.running) {
      await new Promise(r => setTimeout(r, 1000))
    }
    this.cleanup()
  }
}
