// ── Config: settings, history, sessions, project context ──────────────

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ChatMessage, SessionInfo, ModelInfo } from '../types.js'

const CONFIG_DIR = process.env.UNIT01_CONFIG ?? join(homedir(), '.config', 'unit01')
const DATA_DIR = process.env.UNIT01_DATA ?? join(homedir(), '.local', 'share', 'unit01')
const SESSIONS_DIR = join(DATA_DIR, 'sessions')
const HISTORY_FILE = join(DATA_DIR, 'history')

function ensure(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}
ensure(CONFIG_DIR); ensure(DATA_DIR); ensure(SESSIONS_DIR)

// ── Settings ─────────────────────────────────────────────────────────

export interface CommandRule {
  pattern: string
  action: 'allow' | 'deny' | 'prompt'
}

export interface Settings {
  model: string | null
  mode: 'plan' | 'ask' | 'auto-edit' | 'auto' | 'yolo'
  workingDir: string
  contextWindow: number
  ollamaUrl: string
  theme: 'default' | 'matrix' | 'nord' | 'mono'
  commandRules: CommandRule[]
}

const DEFAULT_SETTINGS: Settings = {
  model: null,
  mode: 'ask',
  workingDir: process.cwd(),
  contextWindow: 8192,
  ollamaUrl: 'http://localhost:11434',
  theme: 'default',
  commandRules: [
    { pattern: "^git (status|diff|log|show|branch|tag)( .*)?$", action: "allow" },
    { pattern: "^(npm|bun|yarn|pnpm) (test|run test)( .*)?$", action: "allow" },
    { pattern: "^cargo (test|check|build)( .*)?$", action: "allow" },
    { pattern: "^(pytest|python -m unittest)( .*)?$", action: "allow" }
  ],
}

const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json')

export function loadSettings(): Settings {
  try {
    if (existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'))
      return { ...DEFAULT_SETTINGS, ...data }
    }
  } catch {}
  return DEFAULT_SETTINGS
}

export function saveSettings(s: Partial<Settings>): Settings {
  const cur = loadSettings()
  const next = { ...cur, ...s }
  ensure(CONFIG_DIR)
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2))
  return next
}

// ── History ──────────────────────────────────────────────────────────

export function loadHistory(): string[] {
  try {
    if (existsSync(HISTORY_FILE)) {
      return readFileSync(HISTORY_FILE, 'utf-8').split('\n').filter(Boolean).slice(-500)
    }
  } catch {}
  return []
}

export function saveHistoryItem(item: string) {
  if (!item.trim()) return
  let list = loadHistory()
  if (list[list.length - 1] === item) return
  list.push(item)
  if (list.length > 500) list = list.slice(-500)
  ensure(DATA_DIR)
  writeFileSync(HISTORY_FILE, list.join('\n'))
}

// ── Sessions ─────────────────────────────────────────────────────────

export function listSessions(): SessionInfo[] {
  ensure(SESSIONS_DIR)
  const items: SessionInfo[] = []
  for (const f of readdirSync(SESSIONS_DIR)) {
    if (!f.endsWith('.json')) continue
    try {
      const data = JSON.parse(readFileSync(join(SESSIONS_DIR, f), 'utf-8'))
      items.push({
        name: f.replace(/\.json$/, ''),
        createdAt: data.createdAt ?? 0,
        updatedAt: data.updatedAt ?? 0,
        messageCount: (data.messages ?? []).length,
        preview: (data.messages ?? []).find((m: ChatMessage) => m.role === 'user')?.content?.slice(0, 80) ?? '',
      })
    } catch {}
  }
  return items.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadSession(name: string): { messages: ChatMessage[]; createdAt: number; updatedAt: number } | null {
  const f = join(SESSIONS_DIR, `${name}.json`)
  if (!existsSync(f)) return null
  try {
    return JSON.parse(readFileSync(f, 'utf-8'))
  } catch { return null }
}

export function saveSession(name: string, messages: ChatMessage[]): void {
  const f = join(SESSIONS_DIR, `${name}.json`)
  const data = {
    name,
    createdAt: existsSync(f) ? (statSync(f).birthtimeMs || Date.now()) : Date.now(),
    updatedAt: Date.now(),
    messages,
  }
  writeFileSync(f, JSON.stringify(data, null, 2))
}

export function deleteSession(name: string): boolean {
  const f = join(SESSIONS_DIR, `${name}.json`)
  if (!existsSync(f)) return false
  try { unlinkSync(f); return true } catch { return false }
}

// ── Project context: UNIT.md / AGENTS.md ────────────────────────────

export function loadProjectContext(cwd: string): string {
  const candidates = ['UNIT.md', 'AGENTS.md', 'CLAUDE.md', '.unit01', '.cursorrules']
  const found: string[] = []
  for (const name of candidates) {
    const p = join(cwd, name)
    if (existsSync(p)) {
      const data = readFileSync(p, 'utf-8').trim()
      if (data) {
        const stat = statSync(p)
        found.push(`<${name}>\n${data}\n</${name}>`)
        if (stat.isDirectory()) { /* skip dirs */ }
      }
    }
  }
  if (found.length === 0) return ''
  return '\n\n# Project context (from project files)\n\n' + found.join('\n\n')
}
