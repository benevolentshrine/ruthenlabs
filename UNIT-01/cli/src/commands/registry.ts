// ── Slash command registry ───────────────────────────────────────────

import type { AppContext } from '../app.js'

export interface CommandSpec {
  name: string
  description: string
  args?: string
  run: (ctx: AppContext, args: string) => void | Promise<void>
}

const commands: CommandSpec[] = []

export function registerCommands(cmds: CommandSpec[]) {
  for (const c of cmds) commands.push(c)
}

export function listCommands(): CommandSpec[] {
  return [...commands]
}

export function findCommand(name: string): CommandSpec | null {
  return commands.find(c => c.name === name) ?? null
}

export function matchCommands(prefix: string): CommandSpec[] {
  if (!prefix) return commands.slice(0, 8)
  return commands.filter(c => c.name.startsWith(prefix.toLowerCase())).slice(0, 8)
}
