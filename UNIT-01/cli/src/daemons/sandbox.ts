// ── Sandbox daemon client ─────────────────────────────────────────────

import { rpcOnce } from './socket.js'

export const SANDBOX_SOCKET = '/tmp/ruthen/sandbox.sock'

export interface ExecuteResult {
  verdict: string
  audit_ref: string
}
export interface WorkspaceResult extends ExecuteResult {}
export interface PolicyResult extends ExecuteResult {}

export class SandboxClient {
  socketPath: string
  constructor(socketPath = SANDBOX_SOCKET) {
    this.socketPath = socketPath
  }

  execute(cmd: string, opts: { allow_network?: boolean; timeout_ms?: number } = {}) {
    return rpcOnce<ExecuteResult & { error?: { code: number; message: string } }>(this.socketPath, 'cage_execute', {
      cmd,
      ...(opts.allow_network !== undefined ? { allow_network: opts.allow_network } : {}),
      ...(opts.timeout_ms ? { timeout_ms: opts.timeout_ms } : {}),
    })
  }
  setWorkspace(path: string) {
    return rpcOnce<WorkspaceResult>(this.socketPath, 'set_workspace', { path })
  }
  setPolicy(policy: {
    enabled?: boolean
    deny_network?: boolean
    ecosystems?: string[]
    allowed_domains?: string[]
    excluded_commands?: string[]
    allow_write_paths?: string[]
    deny_write_paths?: string[]
    deny_read_paths?: string[]
  }) {
    return rpcOnce<PolicyResult>(this.socketPath, 'set_policy', policy)
  }
}
