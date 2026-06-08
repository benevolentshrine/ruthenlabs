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

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface OllamaOptions {
  baseUrl?: string
}

export class OllamaError extends Error {
  status: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'OllamaError'
    this.status = status ?? 0
  }
}

export interface OllamaProgress {
  status: string
  completed?: number
  total?: number
}

export class OllamaClient {
  private baseUrl: string

  constructor(options: OllamaOptions = {}) {
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434'
  }

  async checkConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
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

  async *chatStream(
    model: string,
    messages: OllamaMessage[],
    signal?: AbortSignal,
  ): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new OllamaError(`Ollama API error: ${res.status} ${text.slice(0, 200)}`, res.status)
    }

    const reader = res.body?.getReader()
    if (!reader) throw new OllamaError('No response body from Ollama')

    const decoder = new TextDecoder()
    let buffer = ''

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
          try {
            const data = JSON.parse(trimmed)
            if (data.message?.content) {
              yield data.message.content
            }
            if (data.done) return
          } catch {
            // skip partial JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  async chat(
    model: string,
    messages: OllamaMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false }),
      signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new OllamaError(`Ollama API error: ${res.status} ${text.slice(0, 200)}`, res.status)
    }

    const data = await res.json()
    return data.message?.content ?? ''
  }
}
