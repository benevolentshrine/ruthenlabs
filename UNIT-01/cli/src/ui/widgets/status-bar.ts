// ── Status bar (bottom) ──────────────────────────────────────────────

import { ansi, colors, pad, trunc, vw, stripAnsi } from '../../util/ansi.js'
import { fmtNumber } from '../../util/format.js'
import type { AppState } from '../../types.js'
import { modeBadge, getMode } from '../../modes/mode.js'

export function renderStatusBar(state: AppState, width: number): string {
  // Build segments with measured widths so we can drop low-priority ones if we
  // run out of space — preventing terminal wrap that would push the frame
  // out of bounds.
  type Seg = { s: string; w: number; pri: number }
  const segs: Seg[] = []

  const wdRaw = state.workingDir
  segs.push({ s: `${ansi.fg(colors.textMuted)}▸${ansi.reset} ${ansi.fg(colors.text)}${wdRaw}${ansi.reset}`, w: 2 + vw(wdRaw), pri: 5 })

  segs.push({ s: daemonDot(state.indexerState, 'idx'), w: vw(daemonDot(state.indexerState, 'idx')), pri: 4 })
  segs.push({ s: daemonDot(state.sandboxState, 'sbx'), w: vw(daemonDot(state.sandboxState, 'sbx')), pri: 4 })

  segs.push({ s: modeBadge(state.mode), w: vw(modeBadge(state.mode)), pri: 3 })

  if (state.model) {
    const m = state.model.replace(/:latest$/, '')
    segs.push({ s: `${ansi.fg(colors.mag)}${ansi.bold}${m}${ansi.reset}`, w: vw(m), pri: 2 })
  }

  const totalTokens = state.tokensIn + state.tokensOut
  const ctxPct = state.contextWindow > 0 ? Math.round((totalTokens / state.contextWindow) * 100) : 0
  const ctxColor = ctxPct > 85 ? colors.error : ctxPct > 65 ? colors.warn : colors.ok
  const tokenStr = `${fmtNumber(state.tokensIn)}↑${fmtNumber(state.tokensOut)}↓ ${ctxPct}%`
  segs.push({ s: `${ansi.fg(colors.textDim)}${tokenStr}${ansi.reset}`, w: vw(tokenStr), pri: 1 })

  // Separator width
  const sepW = vw(`${ansi.fg(colors.border)}│${ansi.reset}`)
  const sepCount = segs.length - 1
  const overhead = sepW * sepCount
  let budget = width

  // Drop lowest-priority segments that don't fit
  const sorted = segs.slice().sort((a, b) => b.pri - a.pri)
  const kept: Seg[] = []
  for (const seg of sorted) {
    const need = seg.w + (kept.length > 0 ? sepW : 0)
    if (budget >= need) {
      kept.push(seg)
      budget -= need
    }
  }

  // Preserve original order
  const ordered = segs.filter(s => kept.includes(s))
  const out = ordered.map(s => s.s).join(` ${ansi.fg(colors.border)}│${ansi.reset} `)

  // Final safety: if the visible width still exceeds `width`, hard-truncate
  const finalW = vw(out)
  let finalOut = out
  if (finalW > width) {
    finalOut = trunc(stripAnsi(out), width)
  }

  return `${ansi.bg(colors.bgLight)}${pad(finalOut, width)}${ansi.reset}`
}

function daemonDot(s: AppState['indexerState'], label: string): string {
  const map = {
    connected:    { c: colors.ok,    g: '●' },
    connecting:   { c: colors.warn,  g: '◐' },
    disconnected: { c: colors.textMuted, g: '○' },
    error:        { c: colors.error, g: '✗' },
  }
  const m = map[s]
  return `${ansi.fg(m.c)}${m.g}${ansi.reset} ${ansi.fg(colors.textMuted)}${label}${ansi.reset}`
}

export function renderHeader(state: AppState, width: number): string {
  const left = `${ansi.fg(colors.unit)}${ansi.bold}UNIT-01${ansi.reset}`
  const leftW = vw(left)
  const right = state.messages.length > 0
    ? `${ansi.fg(colors.textMuted)}${state.messages.length} msgs${ansi.reset}`
    : `${ansi.fg(colors.textMuted)}no messages${ansi.reset}`
  const rightW = vw(right)
  // "  " prefix + "  " between + "  " suffix
  const fixedOverhead = 6
  const sepW = Math.max(0, width - leftW - rightW - fixedOverhead)
  const sep = `${ansi.fg(colors.border)}${'─'.repeat(sepW)}${ansi.reset}`
  return `  ${left}  ${sep}  ${right}`
}
