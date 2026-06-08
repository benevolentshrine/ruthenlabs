// ── Enhanced Ollama client with tool calling ───────────────────────────

import type { ToolCall, ToolDefinition } from '../types.js'

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls?: ToolCallRequest[]
  tool_call_id?: string
}

export interface ToolCallRequest {
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface OllamaModelInfo {
  name: string
  modified_at: string
  size: number
  digest: string
  details?: {
    format: string
    family: string
    families: string[]
    parameter_size: string
    quantization_level: string
  }
}

export interface ChatChunk {
  model: string
  created_at: string
  message: {
    role: string
    content: string
    tool_calls?: ToolCallRequest[]
  }
  done: boolean
  done_reason?: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  eval_count?: number
  context?: number[]
}

export interface ChatOptions {
  model: string
  messages: OllamaMessage[]
  tools?: ToolDefinition[]
  signal?: AbortSignal
  think?: boolean
  options?: {
    num_ctx?: number
    temperature?: number
    top_p?: number
    top_k?: number
  }
}

export class OllamaError extends Error {
  status: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OllamaError'
    this.status = status ?? 0
  }
}

export class OllamaClient {
  private baseUrl: string

  constructor(baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      return res.ok
    } catch {
      return false
    }
  }

  async listModels(): Promise<OllamaModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/api/tags`)
    if (!res.ok) throw new OllamaError('Failed to fetch models', res.status)
    const data = await res.json()
    return data.models ?? []
  }

  async showModel(name: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new OllamaError(`Failed to show model ${name}`, res.status)
    return res.json()
  }

  // Stream chat, yielding text deltas, tool calls, and final stats
  async *chatStream(opts: ChatOptions): AsyncGenerator<{
    type: 'text' | 'tool_calls' | 'done' | 'thinking'
    text?: string
    toolCalls?: ToolCallRequest[]
    promptTokens?: number
    evalTokens?: number
    totalDuration?: number
  }> {
    const body: any = {
      model: opts.model,
      messages: opts.messages,
      stream: true,
    }
    if (opts.tools && opts.tools.length > 0) body.tools = opts.tools
    if (opts.think) body.think = opts.think
    if (opts.options) body.options = opts.options

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new OllamaError(`Ollama API error: ${res.status} ${text.slice(0, 200)}`, res.status)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new OllamaError('No response body from Ollama')

    const decoder = new TextDecoder()
    let buffer = ''

    // Aggregated tool calls across chunks
    const tcMap = new Map<number, ToolCallRequest>()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          let chunk: ChatChunk
          try {
            chunk = JSON.parse(trimmed)
          } catch { continue }

          const msg = chunk.message ?? ({} as any)

          if (msg.content) {
            yield { type: 'text', text: msg.content }
          }
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              // Ollama streams tool_calls as single deltas (no index field)
              // Aggregate by name+args
              tcMap.set(tcMap.size, tc)
            }
          }

          if (chunk.done) {
            const tcs = Array.from(tcMap.values())
            if (tcs.length > 0) yield { type: 'tool_calls', toolCalls: tcs }
            yield {
              type: 'done',
              promptTokens: chunk.prompt_eval_count,
              evalTokens: chunk.eval_count,
              totalDuration: chunk.total_duration,
            }
            return
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  // Non-streaming chat (returns full text + tool calls)
  async chat(opts: ChatOptions): Promise<{
    content: string
    toolCalls: ToolCallRequest[]
    promptTokens: number
    evalTokens: number
  }> {
    let content = ''
    let toolCalls: ToolCallRequest[] = []
    let promptTokens = 0
    let evalTokens = 0
    for await (const ev of this.chatStream(opts)) {
      if (ev.type === 'text' && ev.text) content += ev.text
      if (ev.type === 'tool_calls' && ev.toolCalls) toolCalls = ev.toolCalls
      if (ev.type === 'done') {
        promptTokens = ev.promptTokens ?? 0
        evalTokens = ev.evalTokens ?? 0
      }
    }
    return { content, toolCalls, promptTokens, evalTokens }
  }

  // Estimate context window for a model
  async getContextLength(model: string): Promise<number> {
    try {
      const info = await this.showModel(model)
      // Try multiple fields
      const ctx = info.model_info?.context_length ?? info.model_info?.['llama.context_length'] ?? 4096
      return Number(ctx)
    } catch {
      return 4096
    }
  }
}
