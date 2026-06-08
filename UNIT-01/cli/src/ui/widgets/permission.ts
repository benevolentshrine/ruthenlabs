// ── Permission modal ─────────────────────────────────────────────────

import { ansi, colors, pad, trunc, vw } from '../../util/ansi.js'
import type { PendingPermission, PermissionDecision } from '../../types.js'

export function renderPermissionModal(p: PendingPermission, width: number, height: number): string[] {
  const w = Math.min(70, width - 4)
  const x = Math.max(0, Math.floor((width - w) / 2))
  const y = Math.max(0, Math.floor((height - 14) / 2))

  const riskColor = p.risk === 'dangerous' ? colors.error : p.risk === 'moderate' ? colors.warn : colors.ok
  const riskLabel = p.risk === 'dangerous' ? 'DANGEROUS' : p.risk === 'moderate' ? 'MODERATE RISK' : 'SAFE'

  const lines: string[] = []

  // Top border
  lines.push(moveTo(y, x) + `${ansi.fg(riskColor)}╔${'═'.repeat(w - 2)}╗${ansi.reset}`)
  lines.push(moveTo(y + 1, x) + `${ansi.fg(riskColor)}║${ansi.reset}${pad(` ${ansi.fg(riskColor)}${ansi.bold}⚠  PERMISSION REQUIRED — ${riskLabel}${ansi.reset}`, w - 2, 'left')}${ansi.fg(riskColor)}║${ansi.reset}`)
  lines.push(moveTo(y + 2, x) + `${ansi.fg(riskColor)}╠${'═'.repeat(w - 2)}╣${ansi.reset}`)

  // Tool name
  lines.push(moveTo(y + 3, x) + `${ansi.fg(riskColor)}║${ansi.reset}  ${ansi.fg(colors.textMuted)}tool:${ansi.reset}    ${ansi.fg(colors.text)}${ansi.bold}${p.toolName}${ansi.reset}${pad('', Math.max(0, w - 14 - p.toolName.length - vw(ansi.reset)), 'left')}${ansi.fg(riskColor)}║${ansi.reset}`)

  // Description
  const desc = trunc(p.description, w - 6)
  lines.push(moveTo(y + 4, x) + `${ansi.fg(riskColor)}║${ansi.reset}  ${ansi.fg(colors.textMuted)}action:${ansi.reset}  ${ansi.fg(colors.text)}${desc}${ansi.reset}${pad('', Math.max(0, w - 12 - vw(desc)), 'left')}${ansi.fg(riskColor)}║${ansi.reset}`)

  // Args (pretty)
  lines.push(moveTo(y + 5, x) + `${ansi.fg(riskColor)}║${ansi.reset}  ${ansi.fg(colors.textMuted)}args:${ansi.reset}${ansi.reset}`)
  const argsStr = JSON.stringify(p.args, null, 2)
  const argLines = argsStr.split('\n').slice(0, 4)
  for (let i = 0; i < argLines.length; i++) {
    const al = trunc(argLines[i], w - 8)
    lines.push(moveTo(y + 6 + i, x) + `${ansi.fg(riskColor)}║${ansi.reset}    ${ansi.fg(colors.textDim)}${al}${ansi.reset}${pad('', Math.max(0, w - 6 - vw(al)), 'left')}${ansi.fg(riskColor)}║${ansi.reset}`)
  }

  // Bottom options
  const yOpt = y + 6 + argLines.length + 1
  lines.push(moveTo(yOpt, x) + `${ansi.fg(riskColor)}╠${'═'.repeat(w - 2)}╣${ansi.reset}`)
  lines.push(moveTo(yOpt + 1, x) + `${ansi.fg(riskColor)}║${ansi.reset}${pad('', w - 2, 'left')}${ansi.fg(riskColor)}║${ansi.reset}`)
  const yKey = `${ansi.fg(colors.ok)}${ansi.bold}Y${ansi.reset} ${ansi.fg(colors.text)}Allow${ansi.reset}    ${ansi.fg(colors.error)}${ansi.bold}N${ansi.reset} ${ansi.fg(colors.text)}Deny${ansi.reset}    ${ansi.fg(colors.unit)}${ansi.bold}A${ansi.reset} ${ansi.fg(colors.text)}Always allow${ansi.reset}`
  const yKeyW = vw(yKey)
  lines.push(moveTo(yOpt + 1, x) + `${ansi.fg(riskColor)}║${ansi.reset}${pad(`  ${yKey}`, w - 2, 'left')}${ansi.fg(riskColor)}║${ansi.reset}`)
  lines.push(moveTo(yOpt + 2, x) + `${ansi.fg(riskColor)}║${ansi.reset}${pad('', w - 2, 'left')}${ansi.fg(riskColor)}║${ansi.reset}`)
  lines.push(moveTo(yOpt + 3, x) + `${ansi.fg(riskColor)}╚${'═'.repeat(w - 2)}╝${ansi.reset}`)

  return lines
}

function moveTo(row: number, col: number): string {
  return ansi.moveTo(row + 1, col + 1)
}
