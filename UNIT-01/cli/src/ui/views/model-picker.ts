// ── Inline model picker (overlay on chat) ────────────────────────────

import { ansi, colors, pad, vw, stripAnsi, trunc } from '../../util/ansi.js'
import { fmtBytes } from '../../util/format.js'
import type { ModelInfo } from '../../types.js'

export function renderModelPicker(
  models: ModelInfo[],
  selected: number,
  width: number,
  height: number,
): string[] {
  if (models.length === 0) return []

  const W = Math.min(60, width - 4)
  const H = Math.min(models.length + 4, height - 4, 14)
  const x = Math.max(0, Math.floor((width - W) / 2))
  const y = Math.max(0, Math.floor((height - H) / 2))

  const lines: string[] = []
  const innerW = Math.max(0, W - 2)
  const m = (row: number, col: number, s: string) => `${ansi.moveTo(row + 1, col + 1)}${s}`

  // Border
  lines.push(m(y,     x, `${ansi.fg(colors.unit)}╔${'═'.repeat(innerW)}╗${ansi.reset}`))
  lines.push(m(y + 1, x, `${ansi.fg(colors.unit)}║${ansi.reset}${pad(` ${ansi.fg(colors.unit)}${ansi.bold}SELECT MODEL${ansi.reset}`, innerW, 'left')}${ansi.fg(colors.unit)}║${ansi.reset}`))
  lines.push(m(y + 2, x, `${ansi.fg(colors.unit)}╠${'═'.repeat(innerW)}╣${ansi.reset}`))

  // Scroll window
  const visible = H - 4
  const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), models.length - visible))
  const end = Math.min(models.length, start + visible)

  let row = y + 3
  for (let i = start; i < end; i++) {
    const md = models[i]
    const isSel = i === selected
    const cursor = isSel ? `${ansi.fg(colors.unit)}${ansi.bold}▌${ansi.reset}` : '  '
    const name = isSel
      ? `${ansi.fg(colors.unit)}${ansi.bold}${md.name}${ansi.reset}`
      : `${ansi.fg(colors.text)}${md.name}${ansi.reset}`
    const meta = `${ansi.fg(colors.textMuted)}${md.parameterSize} · ${md.quantization} · ${fmtBytes(md.size)}${ansi.reset}`
    const inner = ` ${cursor} ${name}  ${meta}`
    const padded = pad(inner, innerW, 'left')
    lines.push(m(row, x, `${ansi.fg(colors.unit)}║${ansi.reset}${padded}${ansi.fg(colors.unit)}║${ansi.reset}`))
    row++
  }

  // Fill remaining
  while (row < y + H - 1) {
    lines.push(m(row, x, `${ansi.fg(colors.unit)}║${ansi.reset}${pad('', innerW, 'left')}${ansi.fg(colors.unit)}║${ansi.reset}`))
    row++
  }

  // Footer with hint
  const hint = `${ansi.fg(colors.textMuted)}↑/↓ navigate · ⏎ select · esc cancel${ansi.reset}`
  const hintW = vw(hint)
  const hintPad = Math.max(0, innerW - hintW - 2)
  lines.push(m(y + H - 1, x, `${ansi.fg(colors.unit)}║${ansi.reset}  ${hint}${pad('', hintPad, 'left')}${ansi.fg(colors.unit)}║${ansi.reset}`))

  // Bottom border
  lines.push(m(y + H, x, `${ansi.fg(colors.unit)}╚${'═'.repeat(innerW)}╝${ansi.reset}`))

  return lines
}
