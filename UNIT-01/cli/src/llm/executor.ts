// ── Agentic loop: LLM <-> Tools ───────────────────────────────────────

import { OllamaClient, type OllamaMessage, type ToolCallRequest } from './ollama.js'
import { TOOL_DEFINITIONS, TOOL_META } from './tools.js'
import type { ChatMessage, ToolCall, PermissionMode, PendingPermission, PendingDiff } from '../types.js'
import { IndexerClient } from '../daemons/indexer.js'
import { SandboxClient } from '../daemons/sandbox.js'
import { uid } from '../util/ansi.js'
import { loadSettings } from '../config/store.js'

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
    const out: OllamaMessage[] = [{ role: 'system', content: this.systemPrompt }]
    for (const m of messages) {
      if (m.role === 'user') {
        out.push({ role: 'user', content: m.content })
      } else if (m.role === 'assistant') {
        const o: OllamaMessage = { role: 'assistant', content: m.content }
        if (m.toolCalls && m.toolCalls.length > 0) {
          o.tool_calls = m.toolCalls.map(tc => ({
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
    let workingMessages = [...messages]

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
        const stream = this.ollama.chatStream({
          model: this.model,
          messages: this.toOllama(workingMessages),
          tools: TOOL_DEFINITIONS,
          signal,
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
        toolCalls: toolCalls.map(tc => ({
          id: uid('tc'),
          name: tc.function.name,
          args: tc.function.arguments,
          status: 'pending' as const,
        })),
        timestamp: Date.now(),
      }
      workingMessages.push(assistantMsg)

      for (let i = 0; i < toolCalls.length; i++) {
        const req = toolCalls[i]
        const toolCall = assistantMsg.toolCalls![i]

        // 4. Check permission
        const meta = TOOL_META[req.function.name] ?? { risk: 'moderate' as const, category: 'read' as const, description: req.function.name }
        const needsPermission = this.needsPermission(req.function.name, meta.risk, req.function.arguments)
        if (needsPermission && !this.alwaysAllow.has(req.function.name)) {
          const pending: PendingPermission = {
            toolName: req.function.name,
            args: req.function.arguments,
            description: this.describeToolCall(req.function.name, req.function.arguments),
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
            const r = await this.indexer.read(req.function.arguments.path as string)
            original = r.content
          } catch {}
          toolCall.originalContent = original

          if (this.mode === 'ask') {
            const updated = req.function.name === 'write_file'
              ? (req.function.arguments.content as string)
              : this.applyPatch(original, req.function.arguments.target as string, req.function.arguments.replacement as string)
            const pending: PendingDiff = {
              filePath: req.function.arguments.path as string,
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
          toolCall.status = 'done'
          toolCall.result = result
          toolCall.durationMs = Date.now() - start
          const toolMsg: ChatMessage = {
            id: uid('msg'),
            role: 'tool',
            content: result,
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
      case 'semantic_search': return `Semantic search: "${args.query}"`
      case 'web_search': return `Web search: "${args.query}"`
      case 'find_files': return `Find: ${args.name}`
      case 'search_files': return `Glob: ${args.pattern}`
      case 'list_directory': return `List: ${args.path}`
      case 'find_dependents': return `Find dependents of ${args.path}`
      case 'find_dependencies': return `Find dependencies of ${args.path}`
      case 'impact_analysis': return `Impact analysis of ${args.path}`
      default: return `${name}(${JSON.stringify(args).slice(0, 80)})`
    }
  }

  private applyPatch(original: string, target: string, replacement: string): string {
    if (!original.includes(target)) return original
    return original.replace(target, replacement)
  }

  private async executeTool(req: ToolCallRequest): Promise<string> {
    const { name, arguments: args } = req.function
    try {
      switch (name) {
        case 'read_file': {
          const path = args.path as string
          const start = args.start_line as number | undefined
          const end = args.end_line as number | undefined
          if (start && end) {
            const r = await this.indexer.readLines(path, start, end)
            return r.content
          }
          const r = await this.indexer.read(path)
          if (r.content.length > 50_000) {
            return r.content.slice(0, 50_000) + `\n\n[... truncated, file is ${r.content.length} bytes. Use start_line/end_line to read specific ranges ...]`
          }
          return r.content
        }
        case 'list_directory': {
          const path = (args.path as string) || '.'
          const r = await this.indexer.find('*', path)
          return r.files.slice(0, 200).join('\n') + (r.files.length > 200 ? `\n[... ${r.files.length - 200} more ...]` : '')
        }
        case 'search_files': {
          const r = await this.indexer.glob(args.pattern as string, (args.base as string) || '.')
          return r.files.slice(0, 200).join('\n') + (r.files.length > 200 ? `\n[... ${r.files.length - 200} more ...]` : '')
        }
        case 'find_files': {
          const r = await this.indexer.find(args.name as string)
          return r.files.slice(0, 50).join('\n')
        }
        case 'search_code': {
          const r = await this.indexer.search(args.query as string, {
            limit: (args.limit as number) ?? 20,
            ...(args.language ? { lang: args.language as string } : {}),
          })
          if (r.results.length === 0) return 'No matches found.'
          return r.results.slice(0, 20).map(res =>
            `${res.path}:${res.line ?? '?'}\n  ${res.content.slice(0, 200)}`
          ).join('\n\n')
        }
        case 'semantic_search': {
          const r = await this.indexer.semanticSearch(args.query as string, (args.limit as number) ?? 10)
          if (r.results.length === 0) return 'No semantic matches found.'
          return r.results.map(res =>
            `${res.path} (score: ${res.score.toFixed(3)})\n  ${res.content.slice(0, 200)}`
          ).join('\n\n')
        }
        case 'web_search': {
          const query = args.query as string
          const results: { title: string; url: string; content: string }[] = []
          try {
            const tavilyKey = process.env.TAVILY_API_KEY
            const braveKey = process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY
            if (tavilyKey) {
              const res = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5 }),
              })
              if (res.ok) {
                const data: any = await res.json()
                if (data.results) {
                  for (const r of data.results) {
                    results.push({ title: r.title || '', url: r.url || '', content: r.content || '' })
                  }
                }
              }
            } else if (braveKey) {
              const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
                headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveKey },
              })
              if (res.ok) {
                const data: any = await res.json()
                if (data.web?.results) {
                  for (const r of data.web.results) {
                    results.push({ title: r.title || '', url: r.url || '', content: r.description || '' })
                  }
                }
              }
            }
            
            if (results.length === 0) {
              const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`)
              if (res.ok) {
                const data: any = await res.json()
                if (data.AbstractText) {
                  results.push({
                    title: data.Heading || query,
                    url: data.AbstractURL || '',
                    content: data.AbstractText,
                  })
                }
                if (data.RelatedTopics) {
                  for (const topic of data.RelatedTopics) {
                    if (topic.Text && topic.FirstURL) {
                      results.push({
                        title: topic.Text.split(' - ')[0] || '',
                        url: topic.FirstURL,
                        content: topic.Text,
                      })
                    }
                  }
                }
              }
            }
          } catch (e: any) {
            return `Web search failed: ${e?.message ?? e}`
          }

          if (results.length === 0) return 'No web search results found.'
          return JSON.stringify(results, null, 2)
        }
        case 'write_file': {
          await this.indexer.write(args.path as string, args.content as string)
          return `Wrote ${(args.content as string).length} bytes to ${args.path}. Shadow backup created.`
        }
        case 'patch_file': {
          await this.indexer.patch(args.path as string, args.target as string, args.replacement as string)
          return `Patched ${args.path}. Shadow backup created.`
        }
        case 'find_dependents': {
          const r = await this.indexer.dependents(args.path as string)
          return r.dependents.length === 0 ? 'No dependents.' : r.dependents.join('\n')
        }
        case 'find_dependencies': {
          const r = await this.indexer.dependencies(args.path as string)
          return r.dependencies.length === 0 ? 'No dependencies.' : r.dependencies.join('\n')
        }
        case 'impact_analysis': {
          const r = await this.indexer.impact(args.path as string)
          return r.impact || 'No impact detected.'
        }
        case 'run_command': {
          const cmd = args.command as string
          const allowNetwork = args.allow_network as boolean | undefined
          const r = await this.sandbox.execute(cmd, allowNetwork !== undefined ? { allow_network: allowNetwork } : {})
          return r.verdict
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
- If you don't know or the user needs to choose, ask. Don't guess.`
  }
}
