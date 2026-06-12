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

  const lines: string[] = []
  
  let title = ''
  if (activeMenu === 'model') title = 'SELECT MODEL'
  else if (activeMenu === 'mode') title = 'SELECT PERMISSION MODE'
  else if (activeMenu === 'resume') title = 'RESUME SESSION'
  else if (activeMenu === 'help') title = 'COMMANDS HELP'

  if (title) {
    lines.push(`  ${ansi.fg(colors.unit)}${ansi.bold}${title}${ansi.reset}`)
  }

  const MODE_DESCS: Record<string, string> = {
    'plan': 'read-only, plan first',
    'ask': 'always ask before action',
    'auto-edit': 'auto-edit, ask on other actions',
    'auto': 'auto-run, ask on danger',
    'yolo': 'no prompts, full speed ahead'
  }

  // Scroll window: show max 10 items
  const visible = 10
  const start = Math.max(0, Math.min(selected - Math.floor(visible / 2), options.length - visible))
  const end = Math.min(options.length, start + visible)

  for (let i = start; i < end; i++) {
    const option = options[i]
    const isSel = i === selected
    const cursor = isSel ? `${ansi.fg(colors.unit)}${ansi.bold}❯${ansi.reset} ` : '  '

    let content = ''
    if (activeMenu === 'commands') {
      const namePadded = pad(option.name, 12)
      const descStr = trunc(option.description, width - 20)
      content = `${cursor}${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset} ${ansi.fg(colors.textDim)}${descStr}${ansi.reset}`
    } else if (activeMenu === 'model') {
      const namePadded = pad(option.name, 24)
      const details = `${option.parameterSize || ''} · ${option.quantization || ''} · ${fmtBytes(option.size)}`
      content = `${cursor}${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset} ${ansi.fg(colors.textDim)}${details}${ansi.reset}`
    } else if (activeMenu === 'mode') {
      const namePadded = pad(option, 12)
      const desc = MODE_DESCS[option] || ''
      content = `${cursor}${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset} ${ansi.fg(colors.textDim)}${desc}${ansi.reset}`
    } else if (activeMenu === 'resume') {
      const namePadded = pad(option.name, 20)
      const countStr = `(${option.messageCount} msgs)`
      const preview = option.preview || ''
      content = `${cursor}${ansi.fg(colors.text)}${ansi.bold}${namePadded}${ansi.reset} ${ansi.fg(colors.textDim)}${countStr} ${preview}${ansi.reset}`
    } else if (activeMenu === 'help') {
      const nameStr = option.name || ''
      const shortcutStr = option.shortcut || ''
      const nameW = vw(nameStr)
      const shortcutW = vw(shortcutStr)
      const spacesCount = Math.max(2, width - nameW - shortcutW - 12)
      content = `${cursor}${nameStr}${' '.repeat(spacesCount)}${ansi.fg(colors.textDim)}${shortcutStr}${ansi.reset}`
    }

    if (isSel) {
      // Highlight the whole line
      lines.push(`  ${ansi.bg(colors.bgHi)}${content}${ansi.reset}`)
    } else {
      lines.push(`  ${content}`)
    }
  }

  // Footer / hint
  const hint = `${ansi.fg(colors.textMuted)}↑/↓ navigate · ⏎ select · esc cancel${ansi.reset}`
  lines.push(`  ${hint}`)

  return lines
}

export function renderDoctorModal(
  doctorInfo: string[],
  width: number,
  height: number,
): string[] {
  const lines: string[] = []
  lines.push(`  ${ansi.fg(colors.unit)}${ansi.bold}SYSTEM STATUS (DOCTOR)${ansi.reset}`)
  lines.push(`  ${ansi.fg(colors.textMuted)}${'─'.repeat(Math.min(40, width - 4))}${ansi.reset}`)
  for (const infoLine of doctorInfo) {
    lines.push(`  ${infoLine}`)
  }
  lines.push(`  ${ansi.fg(colors.textMuted)}${'─'.repeat(Math.min(40, width - 4))}${ansi.reset}`)
  lines.push(`  ${ansi.fg(colors.textMuted)}Press esc / enter to close${ansi.reset}`)
  return lines
}
