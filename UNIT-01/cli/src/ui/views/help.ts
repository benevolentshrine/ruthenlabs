// ── Help overlay ────────────────────────────────────────────────────

import { ansi, colors, pad, vw } from '../../util/ansi.js'

export function renderHelp(width: number, height: number): string[] {
  const sections: { title: string; items: [string, string][] }[] = [
    {
      title: 'KEYBOARD',
      items: [
        ['Enter',         'submit'],
        ['Shift+Tab',     'cycle permission mode'],
        ['Tab',           'autocomplete (@ files, / commands)'],
        ['↑ / ↓',         'history / scroll'],
        ['PgUp / PgDn',   'scroll view'],
        ['Mouse wheel',   'scroll view'],
        ['Esc',           'cancel / close'],
        ['Ctrl+C',        'quit'],
      ],
    },
    {
      title: 'SLASH COMMANDS',
      items: [
        ['/help',         'show this help'],
        ['/init',         'create UNIT.md project context'],
        ['/model',        'switch model'],
        ['/mode [name]',  'set permission mode (plan|ask|auto-edit|auto|yolo)'],
        ['/thinking',     'toggle thinking (on/off)'],
        ['/doctor',       'daemon + token status'],
        ['/index',        'rebuild index'],
        ['/shadow',       'list shadow backups'],
        ['/undo',         'rollback last writes'],
        ['/deps <file>',  'find dependents/dependencies'],
        ['/impact <file>','transitive impact analysis'],
        ['/compress',     'summarize old messages'],
        ['/clear',        'clear screen + messages'],
        ['/save [name]',  'save session'],
        ['/resume <name>','load session'],
        ['/theme [name]', 'set theme (default|matrix|nord|mono)'],
        ['/quit',         'exit'],
      ],
    },
  ]

  const lines: string[] = []
  lines.push(`  ${ansi.fg(colors.unit)}${ansi.bold}UNIT-01 — HELP${ansi.reset}`)
  lines.push(`  ${ansi.fg(colors.textMuted)}${'─'.repeat(Math.min(40, width - 4))}${ansi.reset}`)
  for (const s of sections) {
    lines.push(`  ${ansi.fg(colors.text)}${ansi.bold}${s.title}${ansi.reset}`)
    for (const [k, v] of s.items) {
      lines.push(`    ${ansi.fg(colors.unit)}${pad(k, 15)}${ansi.reset} ${ansi.fg(colors.textDim)}${v}${ansi.reset}`)
    }
  }
  lines.push(`  ${ansi.fg(colors.textMuted)}${'─'.repeat(Math.min(40, width - 4))}${ansi.reset}`)
  lines.push(`  ${ansi.fg(colors.textMuted)}Press esc / enter to close${ansi.reset}`)
  return lines
}
