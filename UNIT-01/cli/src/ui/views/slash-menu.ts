// ── Centered slash commands menu & doctor status modal views ───────────

import { ansi, colors, pad, vw, stripAnsi, trunc } from '../../util/ansi.js'
import { fmtBytes } from '../../util/format.js'

export function renderMenuModal(
  activeMenu: string,
  options: any[],
  selected: number,
  width: number,
  height: number,
): string[] {
  if (options.length === 0) return []

  const hasTitle = activeMenu !== 'commands'
  const W = Math.min(76, width - 4)
  const H = Math.min(options.length + (hasTitle ? 4 : 2), height - 4, 14)
  const x = Math.max(0, Math.floor((width - W) / 2))
  const y = Math.max(0, Math.floor((height - H) / 2))

  const lines: string[] = []
  const bgCard = ansi.bg(colors.bgLight)
  const leftBorder = `${bgCard}  ${ansi.reset}`
  const rightBorder = `${bgCard}  ${ansi.reset}`
  const innerW = Math.max(0, W - 4)
  const m = (row: number, col: number, s: string) => `${ansi.moveTo(row + 1, col + 1)}${s}`

  let title = ''
  if (activeMenu === 'model') title = 'SELECT MODEL'
  else if (activeMenu === 'mode') title = 'SELECT PERMISSION MODE'
  else if (activeMenu === 'resume') title = 'RESUME SESSION'
  else if (activeMenu === 'help') title = 'COMMANDS HELP'

  // Top padding
  lines.push(m(y, x, `${bgCard}${' '.repeat(W)}${ansi.reset}`))

  if (hasTitle) {
    const titleStr = pad(` ${ansi.fg(colors.unit)}${ansi.bold}${title}${ansi.reset}`, innerW, 'left')
    lines.push(m(y + 1, x, `${leftBorder}${titleStr}${rightBorder}`))
    const dividerStr = `${ansi.fg(colors.textMuted)}${'─'.repeat(innerW)}${ansi.reset}`
    lines.push(m(y + 2, x, `${leftBorder}${dividerStr}${rightBorder}`))
  }

  // Scroll window
  const visible = hasTitle ? (H - 4) : (H - 2)
  const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), options.length - visible))
  const end = Math.min(options.length, start + visible)

  const MODE_DESCS: Record<string, string> = {
    'plan': 'read-only, plan first',
    'ask': 'always ask before action',
    'auto-edit': 'auto-edit, ask on other actions',
    'auto': 'auto-run, ask on danger',
    'yolo': 'no prompts, full speed ahead'
  }

  let row = hasTitle ? (y + 3) : (y + 1)
  for (let i = start; i < end; i++) {
    const option = options[i]
    
    if (activeMenu === 'help' && option.category !== undefined) {
      // Category header row
      const catStr = `${ansi.fg(colors.unit)}${ansi.bold}${option.category}${ansi.reset}`
      const padded = pad(`  ${catStr}`, innerW, 'left')
      lines.push(m(row, x, `${leftBorder}${padded}${rightBorder}`))
      row++
      continue
    }

    const isSel = i === selected
    const cursor = isSel ? `${ansi.fg(colors.unit)}${ansi.bold}▌${ansi.reset}` : '  '

    let content = ''
    if (activeMenu === 'commands') {
      const namePadded = pad(option.name, 12)
      const maxDescW = innerW - 16
      const descStr = trunc(option.description, maxDescW)
      content = ` ${cursor} ${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset}${bgCard} ${ansi.fg(colors.textDim)}${descStr}${ansi.reset}`
    } else if (activeMenu === 'model') {
      const namePadded = pad(option.name, 24)
      const details = `${option.parameterSize || ''} · ${option.quantization || ''} · ${fmtBytes(option.size)}`
      content = ` ${cursor} ${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset}${bgCard} ${ansi.fg(colors.textDim)}${details}${ansi.reset}`
    } else if (activeMenu === 'mode') {
      const namePadded = pad(option, 12)
      const desc = MODE_DESCS[option] || ''
      content = ` ${cursor} ${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset}${bgCard} ${ansi.fg(colors.textDim)}${desc}${ansi.reset}`
    } else if (activeMenu === 'resume') {
      const namePadded = pad(option.name, 20)
      const countStr = `(${option.messageCount} msgs)`
      const preview = option.preview || ''
      content = ` ${cursor} ${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset}${bgCard} ${ansi.fg(colors.textDim)}${countStr} ${preview}${ansi.reset}`
    } else if (activeMenu === 'help') {
      const nameStr = option.name || ''
      const shortcutStr = option.shortcut || ''
      const nameW = vw(nameStr)
      const shortcutW = vw(shortcutStr)
      const spacesCount = innerW - nameW - shortcutW - 6
      const nameColored = `${ansi.fg(colors.text)}${nameStr}${ansi.reset}`
      const shortcutColored = `${ansi.fg(colors.textDim)}${shortcutStr}${ansi.reset}`
      content = ` ${cursor} ${nameColored}${' '.repeat(Math.max(1, spacesCount))}${shortcutColored}`
    }

    let lineStr = content
    if (isSel) {
      const clean = stripAnsi(content)
      lineStr = `${ansi.bg(colors.unit)}${ansi.fg(232)}${ansi.bold}${pad(clean, innerW, 'left')}${ansi.reset}`
    } else {
      lineStr = pad(lineStr, innerW, 'left')
    }

    lines.push(m(row, x, `${leftBorder}${lineStr}${rightBorder}`))
    row++
  }

  // Fill remaining
  while (row < y + H - 1) {
    lines.push(m(row, x, `${leftBorder}${pad('', innerW, 'left')}${rightBorder}`))
    row++
  }

  // Footer with hint
  const hint = `${ansi.fg(colors.textMuted)}↑/↓ navigate · ⏎ select · esc cancel${ansi.reset}`
  const hintStr = pad(`  ${hint}`, innerW, 'left')
  lines.push(m(y + H - 1, x, `${leftBorder}${hintStr}${rightBorder}`))

  // Bottom padding
  lines.push(m(y + H, x, `${bgCard}${' '.repeat(W)}${ansi.reset}`))

  return lines
}

export function renderDoctorModal(
  doctorInfo: string[],
  width: number,
  height: number,
): string[] {
  const W = Math.min(68, width - 4)
  const H = Math.min(doctorInfo.length + 4, height - 4, 14)
  const x = Math.max(0, Math.floor((width - W) / 2))
  const y = Math.max(0, Math.floor((height - H) / 2))

  const lines: string[] = []
  const bgCard = ansi.bg(colors.bgLight)
  const leftBorder = `${bgCard}  ${ansi.reset}`
  const rightBorder = `${bgCard}  ${ansi.reset}`
  const innerW = Math.max(0, W - 4)
  const m = (row: number, col: number, s: string) => `${ansi.moveTo(row + 1, col + 1)}${s}`

  // Top padding
  lines.push(m(y, x, `${bgCard}${' '.repeat(W)}${ansi.reset}`))

  // Title
  const titleStr = pad(` ${ansi.fg(colors.unit)}${ansi.bold}SYSTEM STATUS (DOCTOR)${ansi.reset}`, innerW, 'left')
  lines.push(m(y + 1, x, `${leftBorder}${titleStr}${rightBorder}`))
  const dividerStr = `${ansi.fg(colors.textMuted)}${'─'.repeat(innerW)}${ansi.reset}`
  lines.push(m(y + 2, x, `${leftBorder}${dividerStr}${rightBorder}`))

  let row = y + 3
  for (const infoLine of doctorInfo) {
    const padded = pad(`  ${infoLine}`, innerW, 'left')
    lines.push(m(row, x, `${leftBorder}${padded}${rightBorder}`))
    row++
  }

  // Fill remaining
  while (row < y + H - 1) {
    lines.push(m(row, x, `${leftBorder}${pad('', innerW, 'left')}${rightBorder}`))
    row++
  }

  // Footer with hint
  const hint = `${ansi.fg(colors.textMuted)}Press esc / enter to close${ansi.reset}`
  const hintStr = pad(`  ${hint}`, innerW, 'left')
  lines.push(m(y + H - 1, x, `${leftBorder}${hintStr}${rightBorder}`))

  // Bottom padding
  lines.push(m(y + H, x, `${bgCard}${' '.repeat(W)}${ansi.reset}`))

  return lines
}
