// ── Help overlay ────────────────────────────────────────────────────

import { ansi, colors, pad, vw } from '../../util/ansi.js'

export function renderHelp(width: number, height: number): string[] {
  const W = Math.min(80, width - 4)
  const H = Math.min(30, height - 4)
  const x = Math.max(0, Math.floor((width - W) / 2))
  const y = Math.max(0, Math.floor((height - H) / 2))

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
    {
      title: 'MODES',
      items: [
        ['plan',          'read-only, plan first'],
        ['ask',           'ask before every write and execute'],
        ['auto-edit',     'auto-accept writes, ask before exec'],
        ['auto',          'auto-accept all'],
        ['yolo',          'silent auto'],
      ],
    },
  ]

  const lines: string[] = []
  const innerW = Math.max(0, W - 2)
  lines.push(moveTo(y, x) + `${ansi.fg(colors.unit)}╔${'═'.repeat(innerW)}╗${ansi.reset}`)
  lines.push(moveTo(y + 1, x) + `${ansi.fg(colors.unit)}║${ansi.reset}${pad(` ${ansi.fg(colors.unit)}${ansi.bold}UNIT-01 — HELP${ansi.reset}`, innerW, 'left')}${ansi.fg(colors.unit)}║${ansi.reset}`)
  lines.push(moveTo(y + 2, x) + `${ansi.fg(colors.unit)}╠${'═'.repeat(innerW)}╣${ansi.reset}`)

  let row = y + 3
  for (const s of sections) {
    if (row >= y + H - 1) break
    lines.push(moveTo(row, x) + `${ansi.fg(colors.unit)}║${ansi.reset}  ${ansi.fg(colors.text)}${ansi.bold}${s.title}${ansi.reset}${pad('', Math.max(0, W - 4 - s.title.length), 'left')}${ansi.fg(colors.unit)}║${ansi.reset}`)
    row++
    for (const [k, v] of s.items) {
      if (row >= y + H - 1) break
      const kk = `${ansi.fg(colors.unit)}${k}${ansi.reset}`
      const vv = `${ansi.fg(colors.textDim)}${v}${ansi.reset}`
      const line = `  ${kk}  ${vv}`
      lines.push(moveTo(row, x) + `${ansi.fg(colors.unit)}║${ansi.reset}${pad(line, innerW, 'left')}${ansi.fg(colors.unit)}║${ansi.reset}`)
      row++
    }
    row++
  }

  // bottom
  while (row < y + H - 1) {
    lines.push(moveTo(row, x) + `${ansi.fg(colors.unit)}║${ansi.reset}${pad('', innerW, 'left')}${ansi.fg(colors.unit)}║${ansi.reset}`)
    row++
  }
  lines.push(moveTo(row, x) + `${ansi.fg(colors.unit)}╚${'═'.repeat(innerW)}╝${ansi.reset}`)

  return lines
}

function moveTo(row: number, col: number): string {
  return ansi.moveTo(row + 1, col + 1)
}
