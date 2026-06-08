// ── Logo: figlet "Standard" style, 5 rows tall, 7 cols per glyph ─────

import { ansi, colors } from '../../util/ansi.js'

type Glyph = [string, string, string, string, string]

const FONT: Record<string, Glyph> = {
  'U': ['██   ██', '██   ██', '██   ██', '██   ██', '███████'],
  'N': ['███  ██', '████ ██', '██ ████', '██  ███', '██   ██'],
  'I': ['███████', '  ███  ', '  ███  ', '  ███  ', '███████'],
  'T': ['███████', '  ███  ', '  ███  ', '  ███  ', '  ███  '],
  '-': ['       ', '       ', '███████', '       ', '       '],
  '0': ['███████', '██   ██', '██   ██', '██   ██', '███████'],
  '1': ['  ███  ', ' ████  ', '  ███  ', '  ███  ', '███████'],
  '2': ['███████', '     ██', '███████', '██     ', '███████'],
  '3': ['███████', '     ██', '███████', '     ██', '███████'],
  ' ': ['       ', '       ', '       ', '       ', '       '],
}

export function renderFiglet(text: string, color: number = colors.unit): string {
  const lines: string[] = ['', '', '', '', '']
  for (let i = 0; i < text.length; i++) {
    const ch = text[i].toUpperCase()
    const glyph = FONT[ch] ?? FONT[' ']
    for (let r = 0; r < 5; r++) {
      lines[r] += glyph[r]
      if (i < text.length - 1) lines[r] += ' '
    }
  }
  return lines
    .map(l => `${ansi.fg(color)}${ansi.bold}${l}${ansi.reset}`)
    .join('\n')
}

export function renderLogo(): string {
  return renderFiglet('UNIT-01')
}

export function renderWordmark(): string {
  return `${ansi.fg(colors.unit)}${ansi.bold}U N I T  0 1${ansi.reset}`
}

export function renderTagline(): string {
  return `${ansi.fg(colors.textDim)}local. private. capable.${ansi.reset}`
}
