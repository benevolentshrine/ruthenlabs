// ── Agentic loop: LLM <-> Tools ───────────────────────────────────────

import { OllamaClient, type OllamaMessage, type ToolCallRequest } from './ollama.js'
import { TOOL_DEFINITIONS, TOOL_META } from './tools.js'
import type { ChatMessage, ToolCall, PermissionMode, PendingPermission, PendingDiff } from '../types.js'
import { LocalIndexer as IndexerClient } from '../indexer/local.js'
import { LocalSandbox as SandboxClient } from '../sandbox/runner.js'
import { uid } from '../util/ansi.js'
import { loadSettings } from '../config/store.js'
import { mcpManager } from '../mcp/client.js'

export type ToolEvent =
  | { type: 'tool_start'; tool: ToolCall }
  | { type: 'tool_done'; tool: ToolCall }
  | { type: 'tool_text'; text: string }
  | { type: 'tool_calls'; toolCalls: ToolCallRequest[] }
  | { type: 'tool_error'; error: string }
  | { type: 'tool_permission'; pending: PendingPermission }
  | { type: 'tool_diff'; pending: PendingDiff }
  | { type: 'tokens'; prompt: number; eval: number }
  | { type: 'done' }
  | { type: 'aborted' }

export interface ExecutorOptions {
  model: string
  mode: PermissionMode
  indexer: IndexerClient
  sandbox: SandboxClient
  systemPrompt?: string
  contextWindow: number
}

export type ToolPermissionRequester = (pending: PendingPermission) => Promise<'allow' | 'deny' | 'always'>
export type ToolDiffRequester = (pending: PendingDiff) => Promise<'accept' | 'reject' | 'edit'>

export class AgenticExecutor {
  private ollama: OllamaClient
  private indexer: IndexerClient
  private sandbox: SandboxClient
  private model: string
  private mode: PermissionMode
  private systemPrompt: string
  private contextWindow: number
  private abortController: AbortController | null = null
  private alwaysAllow: Set<string> = new Set()

  constructor(opts: ExecutorOptions) {
    this.ollama = new OllamaClient()
    this.indexer = opts.indexer
    this.sandbox = opts.sandbox
    this.model = opts.model
    this.mode = opts.mode
    this.systemPrompt = opts.systemPrompt ?? this.defaultSystemPrompt()
    this.contextWindow = opts.contextWindow
  }

  abort() {
    this.abortController?.abort()
  }

  setMode(mode: PermissionMode) { this.mode = mode }
  setAlwaysAllow(toolName: string) { this.alwaysAllow.add(toolName) }
  clearAlwaysAllow() { this.alwaysAllow.clear() }

  // Convert ChatMessage[] to OllamaMessage[]
  private toOllama(messages: ChatMessage[]): OllamaMessage[] {
    let sysPrompt = this.systemPrompt
    const isSmallModel = this.model.toLowerCase().includes('8b') || 
                         this.model.toLowerCase().includes('7b') || 
                         this.model.toLowerCase().includes('3b') || 
                         this.model.toLowerCase().includes('2b') || 
                         this.model.toLowerCase().includes('1.5b') ||
                         this.model.toLowerCase().includes('llama-3.2') ||
                         this.model.toLowerCase().includes('qwen3')

    if (isSmallModel) {
      // Extract working directory if present
      const match = sysPrompt.match(/Working directory:\s*(.*)/)
      const cwd = match ? match[1].trim() : process.cwd()
      sysPrompt = `You are UNIT-01, a local coding assistant. Keep replies concise.
Working directory: ${cwd}

# Rules for Tool Usage:
- ONLY call tools when they are strictly necessary to answer the user's request.
- Do NOT call any tools for greetings, hello, hellooo, welcome, or simple casual chat. Just reply directly in text.
- If the user asks a general question or greeting, reply directly and do NOT invoke any tools.
- If the user asks to list a directory, call ONLY list_dir. Do NOT call read_file on any files inside unless the user explicitly asks you to read them or inspect their contents.
- Keep tool calls minimal. Do not call multiple tools in parallel unless directly related.
- Investigate code using read_file or search_code before writing.
- Use patch_file for precise, targeted edits. Avoid write_file on existing files.
- Verify changes by running linter/compiler checks via diagnostics.
- Keep output codes complete. Do not use placeholders.

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
- **Completeness**: Always write fully functional, complete CSS and HTML without placeholders.`
    }

    // Inject dynamic Repository Map
    const repoMap = this.indexer.getRepositoryMap ? this.indexer.getRepositoryMap() : ''
    if (repoMap) {
      sysPrompt += `\n\n# Codebase Signatures Map\n${repoMap}`
    }

    const out: OllamaMessage[] = [{ role: 'system', content: sysPrompt }]
    
    // Trim history for small models to prevent context looping
    let targetMessages = messages
    if (isSmallModel && messages.length > 6) {
      // Keep the first message (original prompt) and the last 4 turns
      targetMessages = [
        messages[0]
      ]
      const lastMessages = messages.slice(-4)
      for (const m of lastMessages) {
        if (m.id !== messages[0].id) {
          targetMessages.push(m)
        }
      }
    }

    for (const m of targetMessages) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content })
      } else if (m.role === 'assistant') {
        const o: OllamaMessage = { role: 'assistant', content: m.content }
        if (m.toolCalls && m.toolCalls.length > 0) {
          o.tool_calls = m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.args },
          }))
        }
        out.push(o)
      } else if (m.role === 'tool') {
        out.push({
          role: 'tool',
          content: m.content,
          tool_call_id: m.toolCallId,
        })
      }
    }
    return out
  }

  // Main agentic loop
  async *run(
    messages: ChatMessage[],
    requestPermission: ToolPermissionRequester,
    requestDiff: ToolDiffRequester,
  ): AsyncGenerator<ToolEvent> {
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    let workingMessages = messages
    const executedCalls = new Set<string>()

    // Loop until the LLM stops calling tools
    let loopCount = 0
    const MAX_LOOPS = 25

    while (loopCount < MAX_LOOPS) {
      loopCount++

      // 1. Stream LLM response
      let assistantContent = ''
      const toolCalls: ToolCallRequest[] = []
      let promptTokens = 0
      let evalTokens = 0

      try {
        const mcpTools = mcpManager.getTools()
        const allTools = [...TOOL_DEFINITIONS, ...mcpTools]
        const settings = loadSettings()
        const stream = this.ollama.chatStream({
          model: this.model,
          messages: this.toOllama(workingMessages),
          tools: allTools,
          signal,
          think: settings.think ?? false,
          options: { num_ctx: this.contextWindow, temperature: 0.2 },
        })
        for await (const ev of stream) {
          if (signal.aborted) {
            yield { type: 'aborted' }
            return
          }
          if (ev.type === 'text' && ev.text) {
            assistantContent += ev.text
            yield { type: 'tool_text', text: ev.text }
          } else if (ev.type === 'tool_calls' && ev.toolCalls) {
            toolCalls.push(...ev.toolCalls)
          } else if (ev.type === 'done') {
            promptTokens = ev.promptTokens ?? 0
            evalTokens = ev.evalTokens ?? 0
          }
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          yield { type: 'aborted' }
          return
        }
        yield { type: 'tool_error', error: e?.message ?? String(e) }
        return
      }

      if (signal.aborted) { yield { type: 'aborted' }; return }

      yield { type: 'tokens', prompt: promptTokens, eval: evalTokens }

      // Fallback: Parse JSON tool call from text if native tool calls are empty
      if (toolCalls.length === 0 && assistantContent.trim()) {
        try {
          const jsonBlocks: string[] = []
          
          // 1. Try to find all markdown ```json blocks
          const codeBlockRegex = /```json\s*([\s\S]*?)\s*```/g
          let match
          while ((match = codeBlockRegex.exec(assistantContent)) !== null) {
            jsonBlocks.push(match[1].trim())
          }
          
          // 2. If no markdown blocks, try to find line-by-line JSON objects
          if (jsonBlocks.length === 0) {
            const lines = assistantContent.split('\n')
            for (const line of lines) {
              const trimmed = line.trim()
              if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                jsonBlocks.push(trimmed)
              }
            }
          }
          
          // 3. Process each JSON block with robust parser fallback
          let parsedAny = false
          for (const block of jsonBlocks) {
            const objects = extractJsonObjects(block)
            for (const obj of objects) {
              const parsed = robustParseToolCall(obj)
              if (parsed) {
                toolCalls.push({
                  id: uid('tc'),
                  type: 'function',
                  function: {
                    name: parsed.name,
                    arguments: parsed.arguments
                  }
                })
                parsedAny = true
              }
            }
          }
          
          if (parsedAny) {
            // Strip JSON blocks and lines from text, keeping conversational preambles
            assistantContent = assistantContent
              .replace(/```json\s*[\s\S]*?\s*```/g, '')
              .split('\n')
              .filter(line => !(line.trim().startsWith('{') && line.trim().endsWith('}')))
              .join('\n')
              .trim()
          }
        } catch {}
      }

      // 2. If no tool calls, we're done
      if (toolCalls.length === 0) {
        // Append assistant message
        if (assistantContent) {
          const assistantMsg: ChatMessage = {
            id: uid('msg'),
            role: 'assistant',
            content: assistantContent,
            timestamp: Date.now(),
          }
          workingMessages.push(assistantMsg)
        }
        yield { type: 'done' }
        return
      }

      // 3. Process tool calls
      const assistantMsg: ChatMessage = {
        id: uid('msg'),
        role: 'assistant',
        content: assistantContent,
        toolCalls: toolCalls.map(tc => {
          let parsedArgs: Record<string, unknown> = {}
          if (typeof tc.function.arguments === 'string') {
            try {
              parsedArgs = JSON.parse(tc.function.arguments)
            } catch {}
          } else if (tc.function.arguments) {
            parsedArgs = tc.function.arguments as Record<string, unknown>
          }
          return {
            id: tc.id || uid('tc'),
            name: tc.function.name,
            args: parsedArgs,
            status: 'pending' as const,
          }
        }),
        timestamp: Date.now(),
      }
      workingMessages.push(assistantMsg)

      for (let i = 0; i < toolCalls.length; i++) {
        const req = toolCalls[i]
        const toolCall = assistantMsg.toolCalls![i]

        // Loop detection
        const sig = `${req.function.name}:${JSON.stringify(toolCall.args)}`
        if (executedCalls.has(sig)) {
          toolCall.status = 'error'
          toolCall.error = 'Loop detected'
          const toolMsg: ChatMessage = {
            id: uid('msg'),
            role: 'tool',
            content: `Error: Loop detected. You have already executed ${req.function.name} with these arguments in this turn. Try a different approach or ask the user instead of repeating the same tool call.`,
            toolCallId: toolCall.id,
            toolName: req.function.name,
            timestamp: Date.now(),
          }
          workingMessages.push(toolMsg)
          yield { type: 'tool_done', tool: toolCall }
          continue
        }
        executedCalls.add(sig)

        // 4. Check permission
        const meta = TOOL_META[req.function.name] ?? { risk: 'moderate' as const, category: 'read' as const, description: req.function.name }
        const needsPermission = this.needsPermission(req.function.name, meta.risk, toolCall.args)
        if (needsPermission && !this.alwaysAllow.has(req.function.name)) {
          const pending: PendingPermission = {
            toolName: req.function.name,
            args: toolCall.args,
            description: this.describeToolCall(req.function.name, toolCall.args),
            risk: meta.risk,
            resolve: () => {},
          }
          const decision = await requestPermission(pending)
          if (decision === 'deny') {
            toolCall.status = 'denied'
            const toolMsg: ChatMessage = {
              id: uid('msg'),
              role: 'tool',
              content: 'User denied this tool call.',
              toolCallId: toolCall.id,
              toolName: req.function.name,
              timestamp: Date.now(),
            }
            workingMessages.push(toolMsg)
            yield { type: 'tool_done', tool: toolCall }
            return
          }
          if (decision === 'always') {
            this.alwaysAllow.add(req.function.name)
            toolCall.status = 'approved'
          } else {
            toolCall.status = 'approved'
          }
        } else {
          toolCall.status = 'approved'
        }

        // 5. For write tools, show diff before applying
        if (req.function.name === 'write_file' || req.function.name === 'patch_file') {
          let original = ''
          try {
            const r = await this.indexer.read(toolCall.args.path as string)
            original = r.content
          } catch {}
          toolCall.originalContent = original

          if (this.mode === 'ask') {
            const updated = req.function.name === 'write_file'
              ? (toolCall.args.content as string)
              : this.applyPatch(original, toolCall.args.target as string, toolCall.args.replacement as string)
            const pending: PendingDiff = {
              filePath: toolCall.args.path as string,
              original,
              updated,
              resolve: () => {},
            }
            const decision = await requestDiff(pending)
            if (decision === 'reject') {
              toolCall.status = 'denied'
              const toolMsg: ChatMessage = {
                id: uid('msg'),
                role: 'tool',
                content: 'User rejected this edit. The change was not applied. Try a different approach.',
                toolCallId: toolCall.id,
                toolName: req.function.name,
                timestamp: Date.now(),
              }
              workingMessages.push(toolMsg)
              yield { type: 'tool_done', tool: toolCall }
              continue
            }
          }
        }

        // 6. Execute
        yield { type: 'tool_start', tool: toolCall }
        const start = Date.now()
        toolCall.status = 'running'
        try {
          const result = await this.executeTool(req)
          const maskedResult = maskObservation(req.function.name, result)
          toolCall.status = 'done'
          toolCall.result = result
          toolCall.durationMs = Date.now() - start
          const toolMsg: ChatMessage = {
            id: uid('msg'),
            role: 'tool',
            content: maskedResult,
            toolCallId: toolCall.id,
            toolName: req.function.name,
            timestamp: Date.now(),
          }
          workingMessages.push(toolMsg)
        } catch (e: any) {
          toolCall.status = 'error'
          toolCall.error = e?.message ?? String(e)
          toolCall.durationMs = Date.now() - start
          const toolMsg: ChatMessage = {
            id: uid('msg'),
            role: 'tool',
            content: `Error: ${toolCall.error}`,
            toolCallId: toolCall.id,
            toolName: req.function.name,
            timestamp: Date.now(),
          }
          workingMessages.push(toolMsg)
        }
        yield { type: 'tool_done', tool: toolCall }
      }
    }
  }

  private needsPermission(toolName: string, risk: 'safe' | 'moderate' | 'dangerous', args?: Record<string, unknown>): boolean {
    if (this.mode === 'yolo' || this.mode === 'auto' || this.mode === 'auto-edit') return false
    if (this.mode === 'plan') {
      // plan mode blocks all write/execute, but we only show plan
      return risk !== 'safe'
    }
    if (this.mode === 'ask') {
      if (toolName === 'run_command' && args && typeof args.command === 'string') {
        const cmd = args.command.trim()
        try {
          const settings = loadSettings()
          const rules = settings.commandRules ?? []
          for (const rule of rules) {
            const regex = new RegExp(rule.pattern, 'i')
            if (regex.test(cmd)) {
              if (rule.action === 'allow') {
                return false // bypass permission prompt
              }
            }
          }
        } catch {}
      }
      return true
    }
    return false
  }

  private describeToolCall(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case 'read_file': {
        const path = args.path as string
        const start = args.start_line
        const end = args.end_line
        return start && end ? `Read ${path} lines ${start}-${end}` : `Read ${path}`
      }
      case 'write_file': return `Write ${args.path} (${(args.content as string)?.length ?? 0} bytes)`
      case 'patch_file': return `Patch ${args.path}`
      case 'run_command': return `Run: ${(args.command as string ?? '').slice(0, 80)}`
      case 'search_code': return `Search: "${args.query}"`
      case 'list_dir': return `List: ${args.path || '.'}`
      case 'git_status': return 'Git status check'
      case 'diagnostics': return 'Project diagnostics compilation/lint check'
      default: return `${name}(${JSON.stringify(args).slice(0, 80)})`
    }
  }

  private applyPatch(original: string, target: string, replacement: string): string {
    if (!original.includes(target)) return original
    return original.replace(target, replacement)
  }

  private async executeTool(req: ToolCallRequest): Promise<string> {
    const { name, arguments: args } = req.function
    let parsedArgs = args
    if (typeof parsedArgs === 'string') {
      try {
        parsedArgs = JSON.parse(parsedArgs)
      } catch {
        parsedArgs = {}
      }
    }
    const safeArgs = (parsedArgs || {}) as Record<string, unknown>

    try {
      if (mcpManager.hasTool(name)) {
        return await mcpManager.callTool(name, safeArgs)
      }
      switch (name) {
        case 'read_file': {
          const path = safeArgs.path as string
          const start = safeArgs.start_line as number | undefined
          const end = safeArgs.end_line as number | undefined
          
          const r = await this.indexer.read(path)
          const lines = r.content.split('\n')
          const totalLines = lines.length
          
          let startIdx = 0
          let endIdx = Math.min(200, totalLines)
          
          if (start !== undefined) {
            startIdx = Math.max(0, start - 1)
          }
          if (end !== undefined) {
            endIdx = Math.min(totalLines, end)
          } else if (start !== undefined) {
            endIdx = Math.min(totalLines, startIdx + 200)
          }
          
          if (endIdx - startIdx > 200) {
            endIdx = startIdx + 200
          }
          
          const sliced = lines.slice(startIdx, endIdx).join('\n')
          let suffix = ''
          if (endIdx < totalLines) {
            suffix = `\n\n[... Truncated: showing lines ${startIdx + 1}-${endIdx} of ${totalLines} total lines. Use start_line/end_line to read specific ranges ...]`
          }
          return sliced + suffix
        }
        case 'write_file': {
          await this.indexer.write(safeArgs.path as string, safeArgs.content as string)
          return `Wrote ${(safeArgs.content as string).length} bytes to ${safeArgs.path}. Shadow backup created.`
        }
        case 'patch_file': {
          const path = safeArgs.path as string
          const target = safeArgs.target as string
          const replacement = safeArgs.replacement as string
          const r = await this.indexer.read(path)
          const original = r.content
          
          const firstIdx = original.indexOf(target)
          if (firstIdx === -1) {
            return `Error: target text not found in ${path}. The target text must match EXACTLY.`
          }
          const lastIdx = original.lastIndexOf(target)
          if (firstIdx !== lastIdx) {
            return `Error: target text matches multiple times in ${path}. The target text must be unique to avoid patching the wrong location.`
          }
          
          await this.indexer.patch(path, target, replacement)
          return `Patched ${path}. Shadow backup created.`
        }
        case 'run_command': {
          const cmd = (safeArgs.command as string).trim()
          
          // Blacklist check
          if (cmd.match(/\brm\s+-rf\s+(\/|\*|~\/|~|\$HOME|(?:\.\.\/)+)$/) || cmd.match(/curl\s+.*\s*\|\s*(sh|bash)/) || cmd.match(/wget\s+.*\s*\|\s*(sh|bash)/)) {
            return `Error: Dangerous command blacklisted by sandbox policy.`
          }
          
          try {
            // Set 30s timeout by default
            const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Command timed out after 30 seconds')), 30000))
            const isPkgCmd = /^(go|cargo|npm|bun|pip|yarn|pnpm)\b/.test(cmd)
            const executionPromise = this.sandbox.execute(cmd, { allow_network: isPkgCmd })
            
            const r = await Promise.race([executionPromise, timeoutPromise])
            
            // Cap output to 2000 chars
            let out = r.verdict || ''
            if (out.length > 2000) {
              out = out.slice(0, 2000) + '\n\n[... Truncated: command output exceeded 2000 characters ...]'
            }
            return out
          } catch (e: any) {
            let msg = e?.message ?? String(e)
            if (msg.includes('Filesystem write blocked') || msg.includes('Landlock blocked')) {
              const cwd = process.cwd()
              msg += `\n\n[Actionable Advice] Keep all file operations inside the active workspace directory: "${cwd}". Do not write or read outside this tree. If writing scratch or temporary files, place them in "./tmp/" inside the workspace.`
            } else if (msg.includes('Seccomp blocked') || msg.includes('syscall')) {
              msg += `\n\n[Actionable Advice] This command used a system call restricted by the kernel sandbox. Try using standard shell commands, check your syntax, or ask the user to elevate permissions if this is necessary.`
            }
            return `Error: ${msg}`
          }
        }
        case 'search_code': {
          const r = await this.indexer.search(safeArgs.query as string, { limit: 10 })
          if (r.results.length === 0) return 'No matches found.'
          return r.results.slice(0, 10).map(res =>
            `${res.path}:${res.line ?? '?'}\n  ${res.content.trim().slice(0, 200)}`
          ).join('\n\n')
        }
        case 'list_dir': {
          const path = (safeArgs.path as string) || '.'
          try {
            const { readdirSync, statSync } = await import('fs')
            const { join } = await import('path')
            const files = readdirSync(path)
            if (files.length === 0) return 'Directory is empty.'
            const sliced = files.slice(0, 100)
            const lines = sliced.map(f => {
              try {
                const stat = statSync(join(path, f))
                return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${f}`
              } catch {
                return `[FILE] ${f}`
              }
            })
            if (files.length > 100) {
              lines.push(`\n[... Truncated: ${files.length - 100} more entries. Directory listing capped at 100 entries ...]`)
            }
            return lines.join('\n')
          } catch (e: any) {
            return `Error listing directory: ${e?.message ?? e}`
          }
        }
        case 'git_status': {
          try {
            const branchProc = Bun.spawn(['git', 'branch', '--show-current'], { stdout: 'pipe' })
            const branch = (await new Response(branchProc.stdout).text()).trim()
            
            const statusProc = Bun.spawn(['git', 'status', '--porcelain'], { stdout: 'pipe' })
            const statusText = (await new Response(statusProc.stdout).text()).trim()
            
            const lines = statusText ? statusText.split('\n') : []
            const modified: string[] = []
            const untracked: string[] = []
            const deleted: string[] = []
            const added: string[] = []
            
            for (const line of lines) {
              const code = line.slice(0, 2)
              const file = line.slice(3)
              if (code.includes('M')) {
                modified.push(file)
              } else if (code.includes('?')) {
                untracked.push(file)
              } else if (code.includes('D')) {
                deleted.push(file)
              } else if (code.includes('A')) {
                added.push(file)
              }
            }
            
            return JSON.stringify({
              branch,
              modified,
              untracked,
              deleted,
              added
            }, null, 2)
          } catch (e: any) {
            return `Error running git status: ${e?.message ?? e}`
          }
        }
        case 'diagnostics': {
          try {
            const { existsSync } = await import('fs')
            const { join } = await import('path')
            const cwd = process.cwd()
            
            if (existsSync(join(cwd, 'Cargo.toml'))) {
              const proc = Bun.spawn(['cargo', 'check'], { stderr: 'pipe', stdout: 'pipe' })
              const stdout = await new Response(proc.stdout).text()
              const stderr = await new Response(proc.stderr).text()
              return `cargo check output:\nSTDOUT:\n${stdout.slice(0, 1000)}\nSTDERR:\n${stderr.slice(0, 1000)}`
            }
            
            if (existsSync(join(cwd, 'package.json'))) {
              if (existsSync(join(cwd, 'tsconfig.json'))) {
                const proc = Bun.spawn(['npx', 'tsc', '--noEmit'], { stderr: 'pipe', stdout: 'pipe' })
                const stdout = await new Response(proc.stdout).text()
                const stderr = await new Response(proc.stderr).text()
                if (!stdout && !stderr) return 'No TS diagnostics errors found.'
                return `tsconfig.json found, running tsc --noEmit:\nSTDOUT:\n${stdout.slice(0, 1000)}\nSTDERR:\n${stderr.slice(0, 1000)}`
              }
              const proc = Bun.spawn(['bun', 'test'], { stderr: 'pipe', stdout: 'pipe' })
              const stdout = await new Response(proc.stdout).text()
              const stderr = await new Response(proc.stderr).text()
              return `bun test output:\nSTDOUT:\n${stdout.slice(0, 1000)}\nSTDERR:\n${stderr.slice(0, 1000)}`
            }
            
            return 'No standard project configuration (Cargo.toml, package.json) found to run diagnostics.'
          } catch (e: any) {
            return `Error running diagnostics: ${e?.message ?? e}`
          }
        }
        default:
          return `Unknown tool: ${name}`
      }
    } catch (e: any) {
      return `Error: ${e?.message ?? String(e)}`
    }
  }

  private defaultSystemPrompt(): string {
    return `You are UNIT-01, a local code assistant running on the user's machine.

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
- **Completeness**: Always write fully functional, complete CSS and HTML without placeholders.`
  }
}

interface SearchReplaceBlock {
  search: string
  replace: string
}

function parseSearchReplaceBlocks(blocksStr: string): SearchReplaceBlock[] {
  const lines = blocksStr.split('\n')
  const blocks: SearchReplaceBlock[] = []
  
  let currentSearch: string[] = []
  let currentReplace: string[] = []
  let inSearch = false
  let inReplace = false
  
  for (const line of lines) {
    if (line.startsWith('<<<<<<< SEARCH')) {
      inSearch = true
      inReplace = false
      currentSearch = []
    } else if (line.startsWith('=======')) {
      inSearch = false
      inReplace = true
      currentReplace = []
    } else if (line.startsWith('>>>>>>> REPLACE')) {
      inSearch = false
      inReplace = false
      blocks.push({
        search: currentSearch.join('\n'),
        replace: currentReplace.join('\n'),
      })
    } else {
      if (inSearch) {
        currentSearch.push(line)
      } else if (inReplace) {
        currentReplace.push(line)
      }
    }
  }
  
  if (blocks.length === 0) {
    throw new Error("No valid SEARCH/REPLACE blocks found in the input. Format must use <<<<<<< SEARCH, =======, and >>>>>>> REPLACE.")
  }
  
  return blocks
}

function applySearchReplaceBlocks(content: string, blocksStr: string): string {
  const blocks = parseSearchReplaceBlocks(blocksStr)
  let updated = content
  
  for (const block of blocks) {
    const searchTrimmed = block.search.trim()
    if (!searchTrimmed) {
      throw new Error("Empty SEARCH block is not allowed.")
    }
    
    const index = updated.indexOf(block.search)
    if (index === -1) {
      const normalizedSearch = block.search.replace(/\r\n/g, '\n')
      const normalizedContent = updated.replace(/\r\n/g, '\n')
      const normIndex = normalizedContent.indexOf(normalizedSearch)
      
      if (normIndex === -1) {
        throw new Error(`Could not find the SEARCH block in the file. Make sure the code to find matches exactly, including indentation:\n${block.search}`)
      }
      
      const firstIndex = normalizedContent.indexOf(normalizedSearch)
      const lastIndex = normalizedContent.lastIndexOf(normalizedSearch)
      if (firstIndex !== lastIndex) {
        throw new Error("The SEARCH block matches multiple places in the file. Please provide more context lines to make it unique.")
      }
      
      updated = normalizedContent.slice(0, normIndex) + block.replace + normalizedContent.slice(normIndex + normalizedSearch.length)
    } else {
      const lastIndex = updated.lastIndexOf(block.search)
      if (index !== lastIndex) {
        throw new Error("The SEARCH block matches multiple places in the file. Please provide more context lines to make it unique.")
      }
      updated = updated.slice(0, index) + block.replace + updated.slice(index + block.search.length)
    }
  }
  
  return updated
}

function maskObservation(toolName: string, output: string): string {
  if (!output) return output;
  
  // 1. Strip ANSI escape codes
  let clean = output.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  
  // 2. Suppress repetitive progress bars or build spinner lines
  const lines = clean.split('\n');
  const filteredLines: string[] = [];
  let lastLine = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' && lastLine === '') continue;
    
    // Detect typical progress bar lines and skip duplicate status lines
    const isProgress = trimmed.includes('[===') || trimmed.includes('====>') || trimmed.startsWith('Downloading') || trimmed.startsWith('Extracting');
    if (isProgress) {
      if (lastLine.includes('[===') || lastLine.includes('====>') || lastLine.startsWith('Downloading') || lastLine.startsWith('Extracting')) {
        if (filteredLines.length > 0) {
          filteredLines[filteredLines.length - 1] = trimmed;
        } else {
          filteredLines.push(trimmed);
        }
        lastLine = trimmed;
        continue;
      }
    }
    
    filteredLines.push(line);
    lastLine = trimmed;
  }
  
  clean = filteredLines.join('\n');
  return clean;
}

function robustParseToolCall(block: string): { name: string; arguments: any } | null {
  try {
    const parsed = JSON.parse(block);
    if (parsed && typeof parsed === 'object' && 'name' in parsed) {
      const name = parsed.name as string;
      const args = parsed.arguments || parsed.args || parsed;
      return { name, arguments: args };
    }
  } catch {}

  // Fallback regex-based parser for broken JSON from small models
  try {
    const nameMatch = block.match(/"name"\s*:\s*"([^"]+)"/);
    if (!nameMatch) return null;
    const name = nameMatch[1];

    const args: Record<string, any> = {};

    const extractField = (field: string) => {
      const fieldIdx = block.indexOf(`"${field}"`);
      if (fieldIdx === -1) return false;
      const colonIdx = block.indexOf(':', fieldIdx);
      if (colonIdx === -1) return false;
      
      const quoteMatch = block.slice(colonIdx).match(/(["'`])/);
      if (!quoteMatch || quoteMatch.index === undefined) return false;
      
      const delimiter = quoteMatch[1];
      const valueStart = colonIdx + quoteMatch.index + 1;
      
      const rest = block.slice(valueStart);
      const hasOtherFields = /"(?:path|content|target|replacement|command|name|arguments|args)"\s*:/i.test(rest);
      
      let valueEnd = -1;
      if (!hasOtherFields) {
        // This is the last field, scan backwards from the end of the block
        for (let i = block.length - 1; i >= valueStart; i--) {
          if (block[i] === delimiter && block[i - 1] !== '\\') {
            valueEnd = i;
            break;
          }
        }
      } else {
        // This is not the last field, scan forwards
        for (let i = valueStart; i < block.length; i++) {
          if (block[i] === delimiter && block[i - 1] !== '\\') {
            valueEnd = i;
            break;
          }
        }
      }
      if (valueEnd === -1) {
        // Fallback: strip closing braces/brackets and whitespace at the end of the block
        let endIdx = block.length - 1;
        while (endIdx > valueStart && (block[endIdx] === '}' || block[endIdx] === ']' || /\s/.test(block[endIdx]))) {
          endIdx--;
        }
        if (block[endIdx] === delimiter) {
          endIdx--;
        }
        valueEnd = endIdx + 1;
      }
      if (valueEnd <= valueStart) return false;
      
      let val = block.slice(valueStart, valueEnd);
      val = val
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      args[field] = val;
      return true;
    };

    extractField('path');
    extractField('target');
    extractField('replacement');
    extractField('content');
    extractField('command');

    if (name && (args.path || args.content || args.target || args.command)) {
      return { name, arguments: args };
    }
  } catch {}

  return null;
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let startIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const prevChar = text[i - 1];

    if (inString) {
      if (char === stringChar && prevChar !== '\\') {
        inString = false;
      }
    } else if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
    } else if (char === '{') {
      if (braceCount === 0) {
        startIdx = i;
      }
      braceCount++;
    } else if (char === '}') {
      braceCount--;
      if (braceCount === 0 && startIdx !== -1) {
        objects.push(text.slice(startIdx, i + 1));
        startIdx = -1;
      }
    }
  }
  return objects;
}
