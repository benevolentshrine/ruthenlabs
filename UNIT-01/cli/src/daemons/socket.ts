// ── Async line-delimited JSON-RPC over Unix sockets (Bun) ─────────────

export interface RpcRequest {
  method: string
  params?: Record<string, unknown>
  id?: number
}

export interface RpcResponse<T = unknown> {
  result?: T
  error?: { code: number; message: string }
  id?: number | null
}

export class DaemonError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.name = 'DaemonError'
    this.code = code
  }
}

export class DaemonConnection extends EventTarget {
  private socketPath: string
  private nextId = 1
  private connected = false
  private writer: (s: string) => void = () => {}
  private pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }> = new Map()

  constructor(socketPath: string) {
    super()
    this.socketPath = socketPath
  }

  async connect(): Promise<void> {
    if (this.connected) return
    return new Promise((resolve, reject) => {
      const sock = Bun.connect({
        unix: this.socketPath,
        socket: {
          open: (s) => {
            this.connected = true
            const enc = new TextEncoder()
            const sock = s as any
            this.writer = (text: string) => sock.write(enc.encode(text))
            this.dispatchEvent(new Event('open'))
            resolve()
          },
          data: (_, data) => {
            const text = new TextDecoder().decode(data)
            for (const line of text.split('\n')) {
              if (!line.trim()) continue
              try {
                const res = JSON.parse(line)
                const id = typeof res.id === 'number' ? res.id : Number(res.id)
                const pending = this.pending.get(id)
                if (pending) {
                  this.pending.delete(id)
                  if (res.error) pending.reject(new DaemonError(res.error.code, res.error.message))
                  else pending.resolve(res.result)
                }
              } catch { /* ignore */ }
            }
          },
          close: () => {
            this.connected = false
            this.dispatchEvent(new Event('close'))
          },
          error: (_, e) => {
            this.dispatchEvent(new Event('error'))
            reject(e)
          },
        },
      })
      // store sock for later writes
      ;(this as any)._sock = sock
    })
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.connected) await this.connect()
    const id = this.nextId++
    const req = { jsonrpc: '2.0', method, params: params ?? {}, id }
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.writer(JSON.stringify(req) + '\n')
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`RPC timeout: ${method}`))
        }
      }, 60_000)
    })
  }

  async close(): Promise<void> {
    const sock = (this as any)._sock
    if (sock) { try { sock.end() } catch {} }
    this.connected = false
  }
}

// One-shot RPC for simple request/response (matches daemon's per-connection protocol)
export async function rpcOnce<T = unknown>(socketPath: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const sock = await Bun.connect({
    unix: socketPath,
    socket: {
      open: async (s) => {
        const enc = new TextEncoder()
        const req = { jsonrpc: '2.0', method, params, id: 1 }
        s.write(enc.encode(JSON.stringify(req) + '\n'))
      },
      data: async (s, data) => {
        const text = new TextDecoder().decode(data)
        for (const line of text.split('\n')) {
          if (!line.trim()) continue
          try {
            const res = JSON.parse(line) as RpcResponse<T>
            ;(s as any)._result = res
          } catch {}
        }
        s.end()
      },
      close: () => {},
      error: () => {},
    },
  })
  return new Promise<T>((resolve, reject) => {
    const start = Date.now()
    const t = setInterval(() => {
      const result = (sock as any)._result as RpcResponse<T> | undefined
      if (result) {
        clearInterval(t)
        if (result.error) reject(new DaemonError(result.error.code, result.error.message))
        else resolve(result.result as T)
      } else if (Date.now() - start > 30_000) {
        clearInterval(t)
        reject(new Error(`RPC timeout: ${method}`))
      }
    }, 10)
  })
}
