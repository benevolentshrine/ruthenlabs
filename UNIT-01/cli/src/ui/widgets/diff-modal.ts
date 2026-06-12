// ── Side-by-side diff confirmation modal ──────────────────────────────

import { ansi, colors, pad, trunc, vw } from '../../util/ansi.js'
import type { PendingDiff } from '../../types.js'
import { renderSideBySideDiff } from '../../diff-renderer.js'
import pc from 'picocolors'

export function renderDiffModal(p: PendingDiff, width: number, height: number): string[] {
  const w = Math.min(100, width - 4)
  const lines: string[] = []
  lines.push(`  ${ansi.fg(colors.warn)}┌── ⚡  REVIEW CHANGES — ${p.filePath} ──${'─'.repeat(Math.max(0, w - 26 - p.filePath.length))}┐${ansi.reset}`)
  
  const diffWidth = w - 6
  const diffLines = renderSideBySideDiff(p.original, p.updated, diffWidth)
  const maxDiffShow = 15
  const visibleDiff = diffLines.slice(0, maxDiffShow)
  
  for (let i = 0; i < visibleDiff.length; i++) {
    const content = visibleDiff[i]
    lines.push(`  ${ansi.fg(colors.warn)}│${ansi.reset}  ${content}${pad('', Math.max(0, w - 4 - vw(content)), 'left')}${ansi.fg(colors.warn)}│${ansi.reset}`)
  }
  if (diffLines.length > maxDiffShow) {
    const moreText = pc.dim(`… and ${diffLines.length - maxDiffShow} more lines of changes …`)
    lines.push(`  ${ansi.fg(colors.warn)}│${ansi.reset}  ${moreText}${pad('', Math.max(0, w - 4 - vw(moreText)), 'left')}${ansi.fg(colors.warn)}│${ansi.reset}`)
  }
  
  lines.push(`  ${ansi.fg(colors.warn)}├──${'─'.repeat(w - 4)}──┤${ansi.reset}`)
  const prompt = `${ansi.fg(colors.ok)}${ansi.bold}y${ansi.reset} Accept    ${ansi.fg(colors.error)}${ansi.bold}n${ansi.reset} Reject`
  lines.push(`  ${ansi.fg(colors.warn)}│${ansi.reset}  ${prompt}${pad('', Math.max(0, w - 4 - vw(prompt)), 'left')}${ansi.fg(colors.warn)}│${ansi.reset}`)
  lines.push(`  ${ansi.fg(colors.warn)}└─${'─'.repeat(w - 4)}──┘${ansi.reset}`)
  return lines
}
