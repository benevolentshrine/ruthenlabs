// ── Permission modal ─────────────────────────────────────────────────

import { ansi, colors, pad, trunc, vw } from '../../util/ansi.js'
import type { PendingPermission, PermissionDecision } from '../../types.js'

export function renderPermissionModal(p: PendingPermission, width: number, height: number): string[] {
  const w = Math.min(80, width - 4)
  const riskColor = p.risk === 'dangerous' ? colors.error : p.risk === 'moderate' ? colors.warn : colors.ok
  const riskLabel = p.risk === 'dangerous' ? 'DANGEROUS' : p.risk === 'moderate' ? 'MODERATE RISK' : 'SAFE'

  const lines: string[] = []
  lines.push(`  ${ansi.fg(riskColor)}┌── ⚠  PERMISSION REQUIRED — ${riskLabel} ──${'─'.repeat(Math.max(0, w - 30 - riskLabel.length))}┐${ansi.reset}`)
  lines.push(`  ${ansi.fg(riskColor)}│${ansi.reset}  ${ansi.fg(colors.textMuted)}tool:${ansi.reset}    ${ansi.fg(colors.text)}${ansi.bold}${p.toolName}${ansi.reset}${pad('', Math.max(0, w - 14 - p.toolName.length), 'left')}${ansi.fg(riskColor)}│${ansi.reset}`)
  lines.push(`  ${ansi.fg(riskColor)}│${ansi.reset}  ${ansi.fg(colors.textMuted)}action:${ansi.reset}  ${ansi.fg(colors.text)}${trunc(p.description, w - 14)}${ansi.reset}${pad('', Math.max(0, w - 12 - vw(trunc(p.description, w - 14))), 'left')}${ansi.fg(riskColor)}│${ansi.reset}`)
  lines.push(`  ${ansi.fg(riskColor)}│${ansi.reset}  ${ansi.fg(colors.textMuted)}args:${ansi.reset}${pad('', w - 10, 'left')}${ansi.fg(riskColor)}│${ansi.reset}`)
  
  const argsStr = JSON.stringify(p.args, null, 2)
  const argLines = argsStr.split('\n').slice(0, 10)
  for (const al of argLines) {
    const truncatedArg = trunc(al, w - 8)
    lines.push(`  ${ansi.fg(riskColor)}│${ansi.reset}    ${ansi.fg(colors.textDim)}${truncatedArg}${ansi.reset}${pad('', Math.max(0, w - 6 - vw(truncatedArg)), 'left')}${ansi.fg(riskColor)}│${ansi.reset}`)
  }
  
  lines.push(`  ${ansi.fg(riskColor)}├──${'─'.repeat(w - 4)}──┤${ansi.reset}`)
  const yKey = `${ansi.fg(colors.ok)}${ansi.bold}y${ansi.reset} Allow    ${ansi.fg(colors.error)}${ansi.bold}n${ansi.reset} Deny    ${ansi.fg(colors.unit)}${ansi.bold}a${ansi.reset} Always allow`
  lines.push(`  ${ansi.fg(riskColor)}│${ansi.reset}  ${yKey}${pad('', Math.max(0, w - 4 - vw(yKey)), 'left')}${ansi.fg(riskColor)}│${ansi.reset}`)
  lines.push(`  ${ansi.fg(riskColor)}└─${'─'.repeat(w - 4)}──┘${ansi.reset}`)
  return lines
}
