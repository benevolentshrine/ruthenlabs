// ── Side-by-side diff confirmation modal ──────────────────────────────

import { ansi, colors, pad, trunc, vw } from '../../util/ansi.js'
import type { PendingDiff } from '../../types.js'
import { renderSideBySideDiff } from '../../diff-renderer.js'
import pc from 'picocolors'

export function renderDiffModal(p: PendingDiff, width: number, height: number): string[] {
  const w = Math.min(100, width - 4)
  const h = Math.min(24, height - 4)
  const x = Math.max(0, Math.floor((width - w) / 2))
  const y = Math.max(0, Math.floor((height - h) / 2))

  const lines: string[] = []

  // Top border
  lines.push(moveTo(y, x) + `${ansi.fg(colors.warn)}╔${'═'.repeat(w - 2)}╗${ansi.reset}`)
  const title = ` REVIEW CHANGES — ${p.filePath} `
  lines.push(moveTo(y + 1, x) + `${ansi.fg(colors.warn)}║${ansi.reset}${pad(` ${ansi.fg(colors.warn)}${ansi.bold}⚡ ${title}${ansi.reset}`, w - 2, 'left')}${ansi.fg(colors.warn)}║${ansi.reset}`)
  lines.push(moveTo(y + 2, x) + `${ansi.fg(colors.warn)}╠${'═'.repeat(w - 2)}╣${ansi.reset}`)

  // Render the side-by-side diff
  const diffWidth = w - 6
  const diffHeight = h - 6
  const diffLines = renderSideBySideDiff(p.original, p.updated, diffWidth)
  
  const visibleDiff = diffLines.slice(0, diffHeight)
  
  for (let i = 0; i < diffHeight; i++) {
    const row = y + 3 + i
    let content = ''
    if (i < visibleDiff.length) {
      content = visibleDiff[i]
    } else if (i === visibleDiff.length && diffLines.length > diffHeight) {
      content = pc.dim('… and more changes below …')
    }
    
    lines.push(moveTo(row, x) + `${ansi.fg(colors.warn)}║${ansi.reset}  ${content}${pad('', Math.max(0, w - 4 - vw(content)), 'left')}${ansi.fg(colors.warn)}║${ansi.reset}`)
  }

  const yOpt = y + 3 + diffHeight
  lines.push(moveTo(yOpt, x) + `${ansi.fg(colors.warn)}╠${'═'.repeat(w - 2)}╣${ansi.reset}`)
  
  const prompt = `${ansi.fg(colors.ok)}${ansi.bold}Y / Enter${ansi.reset} ${ansi.fg(colors.text)}Accept${ansi.reset}    ${ansi.fg(colors.error)}${ansi.bold}N / Esc${ansi.reset} ${ansi.fg(colors.text)}Reject${ansi.reset}`
  lines.push(moveTo(yOpt + 1, x) + `${ansi.fg(colors.warn)}║${ansi.reset}${pad(`  ${prompt}`, w - 2, 'left')}${ansi.fg(colors.warn)}║${ansi.reset}`)
  lines.push(moveTo(yOpt + 2, x) + `${ansi.fg(colors.warn)}╚${'═'.repeat(w - 2)}╝${ansi.reset}`)

  return lines
}

function moveTo(row: number, col: number): string {
  return ansi.moveTo(row + 1, col + 1)
}
