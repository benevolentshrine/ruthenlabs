// ── Permission modes ──────────────────────────────────────────────────

import type { PermissionMode } from '../types.js'
import { ansi, colors } from '../util/ansi.js'

export interface ModeInfo {
  id: PermissionMode
  label: string
  short: string
  description: string
  color: number
}

export const MODES: ModeInfo[] = [
  { id: 'plan',      label: 'PLAN',      short: 'P', description: 'Plan first, no writes or executions', color: colors.sys },
  { id: 'ask',       label: 'ASK',       short: 'A', description: 'Ask before every write and execute', color: colors.unit },
  { id: 'auto-edit', label: 'AUTO-EDIT', short: 'E', description: 'Auto-accept writes, ask before exec', color: colors.unit },
  { id: 'auto',      label: 'AUTO',      short: 'U', description: 'Auto-accept all writes and executes', color: colors.unit },
  { id: 'yolo',      label: 'YOLO',      short: 'Y', description: 'Silent auto, no UI prompts', color: colors.unit },
]

export function getMode(id: PermissionMode): ModeInfo {
  return MODES.find(m => m.id === id) ?? MODES[1]
}

export function nextMode(current: PermissionMode): PermissionMode {
  const i = MODES.findIndex(m => m.id === current)
  return MODES[(i + 1) % MODES.length].id
}

export function renderMode(mode: PermissionMode): string {
  const m = getMode(mode)
  return `${ansi.fg(m.color)}${ansi.bold}${m.label}${ansi.reset}`
}

export function modeBadge(mode: PermissionMode): string {
  const m = getMode(mode)
  return `${ansi.fg(m.color)}●${ansi.reset} ${ansi.fg(m.color)}${ansi.bold}${m.label}${ansi.reset}`
}
