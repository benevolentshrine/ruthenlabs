// ── Core types for Unit-01 CLI ─────────────────────────────────────────

export type Role = 'user' | 'assistant' | 'system' | 'tool'

export type PermissionMode = 'plan' | 'ask' | 'auto-edit' | 'auto' | 'yolo'

export type DaemonState = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface ChatMessage {
  id: string
  role: Role
  content: string
  toolCallId?: string
  toolCalls?: ToolCall[]
  toolName?: string
  timestamp: number
  thoughtDuration?: number
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  status: 'pending' | 'approved' | 'denied' | 'running' | 'done' | 'error'
  result?: string
  error?: string
  durationMs?: number
  originalContent?: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required: string[]
    }
  }
}

export type RiskLevel = 'safe' | 'moderate' | 'dangerous'

export interface ToolMeta {
  risk: RiskLevel
  category: 'read' | 'write' | 'execute' | 'analyze'
  description: string
}

export interface KeyEvent {
  ctrl: boolean
  meta: boolean
  shift: boolean
  name: string | null
  sequence: string
  raw: string
}

export type KeyHandler = (key: KeyEvent) => boolean | void

export interface SessionInfo {
  name: string
  createdAt: number
  updatedAt: number
  messageCount: number
  preview: string
}

export interface ModelInfo {
  name: string
  size: number
  family: string
  parameterSize: string
  quantization: string
  modifiedAt: string
}

export interface AppState {
  view: 'boot' | 'chat' | 'permission' | 'help' | 'palette' | 'diff'
  model: string | null
  mode: PermissionMode
  workingDir: string
  messages: ChatMessage[]
  streaming: boolean
  streamingText: string
  currentToolCalls: ToolCall[]
  tokensIn: number
  tokensOut: number
  contextWindow: number
  indexerState: DaemonState
  sandboxState: DaemonState
  status: string
  pendingPermission: PendingPermission | null
  pendingDiff: PendingDiff | null
  palette: { active: boolean; query: string; index: number } | null
  helpOpen: boolean
  // Inline model picker (opened by /model with no args)
  modelPicker: { index: number } | null
}

export interface PendingPermission {
  toolName: string
  args: Record<string, unknown>
  description: string
  risk: RiskLevel
  resolve: (decision: PermissionDecision) => void
}

export type PermissionDecision = 'allow' | 'deny' | 'always'

export interface PendingDiff {
  filePath: string
  original: string
  updated: string
  resolve: (decision: 'accept' | 'reject' | 'edit') => void
}

export interface LogEntry {
  id: string
  level: 'info' | 'warn' | 'error' | 'success' | 'tool' | 'dim'
  message: string
  timestamp: number
}
