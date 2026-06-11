// ── Enhanced Ollama/OpenAI client with tool calling ───────────────────────────

import type { ToolCall, ToolDefinition } from '../types.js'

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls?: ToolCallRequest[]
  tool_call_id?: string
}

export interface ToolCallRequest {
  id?: string
  type?: 'function'
  function: {
    name: string
    arguments: Record<string, unknown> | string
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

export function getContextFromParamSize(paramSizeStr: string | undefined): number {
  if (!paramSizeStr) return 32768
  const match = paramSizeStr.match(/^([0-9.]+)([a-zA-Z]*)/)
  if (!match) return 32768
  const num = parseFloat(match[1])
  
  const isMoE = paramSizeStr.toLowerCase().includes('moe') || paramSizeStr.toLowerCase().includes('x')
  if (isMoE) return 131072 // MoE: 128K

  if (num < 4) {
    return 8192 // 1B-3B: 8K
  } else if (num >= 4 && num <= 16) {
    return 32768 // 7B-8B / 13B-14B: 32K
  } else if (num > 16 && num <= 34) {
    return 65536 // 32B: 64K
  } else if (num > 34) {
    return 32768 // 70B+: 32K (to conserve VRAM)
  }
  return 32768
}

export function getContextFromModelName(modelName: string): number {
  const name = modelName.toLowerCase()
  if (name.includes('moe') || name.includes('mixtral')) return 131072
  
  const match = name.match(/([0-9.]+)\s*b/)
  if (match) {
    const num = parseFloat(match[1])
    if (num < 4) return 8192
    if (num >= 4 && num <= 16) return 32768
    if (num > 16 && num <= 34) return 65536
    return 32768 // 70b+
  }
  
  if (name.includes('mini') || name.includes('small') || name.includes('1b') || name.includes('3b')) return 8192
  if (name.includes('medium') || name.includes('7b') || name.includes('8b') || name.includes('14b') || name.includes('13b')) return 32768
  if (name.includes('large') || name.includes('70b') || name.includes('72b')) return 32768
  
  return 32768
}

export class OllamaClient {
  private baseUrl: string
  private isOllama = true

  constructor(baseUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        this.isOllama = true
        return true
      }
    } catch {}

    try {
      const endpoint = this.baseUrl.endsWith('/v1') ? `${this.baseUrl}/models` : `${this.baseUrl}/v1/models`
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) })
      if (res.ok) {
        this.isOllama = false
        return true
      }
    } catch {}

    return false
  }

  async listModels(): Promise<OllamaModelInfo[]> {
    if (this.isOllama) {
      const res = await fetch(`${this.baseUrl}/api/tags`)
      if (!res.ok) throw new OllamaError('Failed to fetch models', res.status)
      const data = await res.json()
      return data.models ?? []
    } else {
      const endpoint = this.baseUrl.endsWith('/v1') ? `${this.baseUrl}/models` : `${this.baseUrl}/v1/models`
      const res = await fetch(endpoint)
      if (!res.ok) throw new OllamaError('Failed to fetch models from OpenAI endpoint', res.status)
      const data = await res.json()
      return (data.data ?? []).map((m: any) => ({
        name: m.id,
        modified_at: new Date().toISOString(),
        size: 0,
        digest: m.id,
      }))
    }
  }

  async showModel(name: string): Promise<any> {
    if (!this.isOllama) return {}
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
    if (this.isOllama) {
      const body: any = {
        model: opts.model,
        messages: opts.messages,
        stream: true,
      }
      if (opts.tools && opts.tools.length > 0) body.tools = opts.tools
      if (opts.think !== undefined) body.think = opts.think
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
                const key = tc.id || (tc.function && (tc.function as any).index !== undefined ? (tc.function as any).index : tcMap.size);
                const existing = tcMap.get(key);
                if (existing) {
                  if (tc.id) existing.id = tc.id;
                  if (tc.type) existing.type = tc.type;
                  if (tc.function) {
                    if (tc.function.name) existing.function.name = tc.function.name;
                    if (tc.function.arguments) {
                      if (typeof existing.function.arguments === 'object' && existing.function.arguments !== null &&
                          typeof tc.function.arguments === 'object' && tc.function.arguments !== null) {
                        existing.function.arguments = {
                          ...existing.function.arguments,
                          ...tc.function.arguments
                        };
                      } else {
                        existing.function.arguments = tc.function.arguments;
                      }
                    }
                  }
                } else {
                  tcMap.set(key, tc);
                }
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
    } else {
      // OpenAI-compatible Chat Completions
      const endpoint = this.baseUrl.endsWith('/v1') ? `${this.baseUrl}/chat/completions` : `${this.baseUrl}/v1/chat/completions`
      const formattedMessages = opts.messages.map(m => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
        ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
      }))

      const body: any = {
        model: opts.model,
        messages: formattedMessages,
        stream: true,
      }
      if (opts.tools && opts.tools.length > 0) {
        body.tools = opts.tools.map(t => ({
          type: 'function',
          function: {
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
          }
        }))
      }
      if (opts.options?.temperature !== undefined) body.temperature = opts.options.temperature

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: opts.signal,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new OllamaError(`OpenAI API error: ${res.status} ${text.slice(0, 200)}`, res.status)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new OllamaError('No response body from OpenAI endpoint')

      const decoder = new TextDecoder()
      let buffer = ''
      const tcMap = new Map<number, any>()

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
            if (trimmed === 'data: [DONE]') {
              break
            }
            if (!trimmed.startsWith('data: ')) continue
            const dataStr = trimmed.slice(6)
            let chunk: any
            try {
              chunk = JSON.parse(dataStr)
            } catch { continue }

            const choice = chunk.choices?.[0]
            if (!choice) continue

            const delta = choice.delta
            if (delta?.content) {
              yield { type: 'text', text: delta.content }
            }

            if (delta?.tool_calls && delta.tool_calls.length > 0) {
              for (const tc of delta.tool_calls) {
                const key = tc.index !== undefined ? tc.index : tcMap.size
                const existing = tcMap.get(key)
                if (existing) {
                  if (tc.id) existing.id = tc.id
                  if (tc.type) existing.type = tc.type
                  if (tc.function) {
                    if (tc.function.name) existing.function.name = tc.function.name
                    if (tc.function.arguments) {
                      existing.function.arguments = (existing.function.arguments || '') + tc.function.arguments
                    }
                  }
                } else {
                  tcMap.set(key, {
                    id: tc.id,
                    type: tc.type || 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || ''
                    }
                  })
                }
              }
            }

            if (choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls') {
              const tcs = Array.from(tcMap.values()).map(tc => {
                let parsedArgs = tc.function.arguments
                if (typeof parsedArgs === 'string') {
                  try {
                    parsedArgs = JSON.parse(parsedArgs)
                  } catch {
                    parsedArgs = {}
                  }
                }
                return {
                  id: tc.id,
                  type: tc.type,
                  function: {
                    name: tc.function.name,
                    arguments: parsedArgs as Record<string, unknown>
                  }
                }
              })
              if (tcs.length > 0) yield { type: 'tool_calls', toolCalls: tcs }
              yield { type: 'done' }
              return
            }
          }
        }

        // Fallback after loop ends if not caught by finish_reason
        const tcs = Array.from(tcMap.values()).map(tc => {
          let parsedArgs = tc.function.arguments
          if (typeof parsedArgs === 'string') {
            try {
              parsedArgs = JSON.parse(parsedArgs)
            } catch {
              parsedArgs = {}
            }
          }
          return {
            id: tc.id,
            type: tc.type,
            function: {
              name: tc.function.name,
              arguments: parsedArgs as Record<string, unknown>
            }
          }
        })
        if (tcs.length > 0) yield { type: 'tool_calls', toolCalls: tcs }
        yield { type: 'done' }
      } finally {
        reader.releaseLock()
      }
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
  async getContextLength(model: string, maxContextOverride?: number): Promise<number> {
    if (maxContextOverride && maxContextOverride > 0) {
      return maxContextOverride
    }
    
    if (this.isOllama) {
      try {
        const info = await this.showModel(model)
        const paramSize = info.details?.parameter_size
        if (paramSize) {
          return getContextFromParamSize(paramSize)
        }
        const ctx = info.model_info?.context_length ?? info.model_info?.['llama.context_length']
        if (ctx) return Number(ctx)
      } catch {}
    }
    return getContextFromModelName(model)
  }
}
