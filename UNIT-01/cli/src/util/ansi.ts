// ── ANSI / terminal helpers ────────────────────────────────────────────

export const ESC = '\x1b'
export const CSI = '\x1b['

export const ansi = {
  reset:         `${CSI}0m`,
  bold:          `${CSI}1m`,
  dim:           `${CSI}2m`,
  italic:        `${CSI}3m`,
  underline:     `${CSI}4m`,
  inverse:       `${CSI}7m`,
  strike:        `${CSI}9m`,

  fg: (n: number) => `${CSI}38;5;${n}m`,
  bg: (n: number) => `${CSI}48;5;${n}m`,
  rgb: (r: number, g: number, b: number) => `${CSI}38;2;${r};${g};${b}m`,
  bgRgb: (r: number, g: number, b: number) => `${CSI}48;2;${r};${g};${b}m`,

  moveTo: (row: number, col: number) => `${CSI}${row};${col}H`,
  cursorUp: (n = 1) => `${CSI}${n}A`,
  cursorDown: (n = 1) => `${CSI}${n}B`,
  cursorRight: (n = 1) => `${CSI}${n}C`,
  cursorLeft: (n = 1) => `${CSI}${n}D`,
  cursorSave: `${CSI}s`,
  cursorRestore: `${CSI}u`,

  clearScreen: `${CSI}2J`,
  clearLine: `${CSI}2K`,
  clearLineRight: `${CSI}K`,
  clearLineDown: `${CSI}J`,
  clearScrollback: `${CSI}3J`,

  enterAltScreen: `${CSI}?1049h`,
  exitAltScreen: `${CSI}?1049l`,

  hideCursor: `${CSI}?25l`,
  showCursor: `${CSI}?25h`,

  enableMouse: `${CSI}?1000h${CSI}?1002h${CSI}?1006h`,
  disableMouse: `${CSI}?1000l${CSI}?1002l${CSI}?1006l`,
  enableBracketedPaste: `${CSI}?2004h`,
  disableBracketedPaste: `${CSI}?2004l`,

  enableSync: `${CSI}?2026h`,
  disableSync: `${CSI}?2026l`,

  scrollUp: `${CSI}S`,
  scrollDown: `${CSI}T`,
}

// Color palette — Steel Blue theme with original deep slate borders
export const colors = {
  // Brand
  unit:    110,  // Steel Blue
  mag:     110,  // Steel Blue
  // Roles
  user:    15,   // Pure White (for user messages)
  asst:    110,  // Steel Blue (for assistant messages)
  sys:     67,   // Original Steel Blue/Slate
  tool:    242,  // Slate Grey
  error:   110,  // Steel Blue
  warn:    110,  // Steel Blue
  ok:      110,  // Steel Blue
  // UI
  border:  60,   // Original Deep Slate Blue-Grey
  borderHi: 110, // Steel Blue
  text:    252,  // Off-white / White
  textDim: 244,  // Lighter Slate Grey
  textMuted: 240,// Darker Slate Grey
  bg:      232,  // Near-black bg
  bgLight: 235,  // Slightly raised bg
  bgHi:    236,  // Emphasized bg
  bgPanel: 233,  // Darker than bg but not pure black
  // Semantic
  read:    242,  // Slate Grey
  write:   110,  // Steel Blue
  exec:    110,  // Steel Blue
  analyze: 242,  // Slate Grey
  // Status
  ok2:     110,  // Steel Blue
  err:     240,  // Slate Grey
  idle:    240,  // Slate Grey
}

export const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

let nextId = 0
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${(++nextId).toString(36)}`

// Visible width of a string (excluding ANSI codes, counting wide chars as 2)
export function vw(s: string): number {
  let w = 0
  let i = 0
  while (i < s.length) {
    if (s.charCodeAt(i) === 0x1b) {
      // skip ANSI sequence
      const end = s.indexOf('m', i)
      if (end !== -1) {
        i = end + 1
        continue
      }
    }
    const code = s.codePointAt(i)!
    if (code < 0x20 || code === 0x7f) {
      i++
      continue
    }
    // East Asian wide and fullwidth
    const isWide =
      (code >= 0x1100 && code <= 0x115F) ||
      (code >= 0x2E80 && code <= 0x303E) ||
      (code >= 0x3041 && code <= 0x33FF) ||
      (code >= 0x3400 && code <= 0x4DBF) ||
      (code >= 0x4E00 && code <= 0x9FFF) ||
      (code >= 0xA000 && code <= 0xA4CF) ||
      (code >= 0xAC00 && code <= 0xD7A3) ||
      (code >= 0xF900 && code <= 0xFAFF) ||
      (code >= 0xFE30 && code <= 0xFE4F) ||
      (code >= 0xFF00 && code <= 0xFF60) ||
      (code >= 0xFFE0 && code <= 0xFFE6)
    w += isWide ? 2 : 1
    i += code > 0xFFFF ? 2 : 1
  }
  return w
}

// Pad/truncate to visible width
export function pad(s: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const w = vw(s)
  if (w >= width) return s
  const diff = width - w
  if (align === 'left') return s + ' '.repeat(diff)
  if (align === 'right') return ' '.repeat(diff) + s
  const l = Math.floor(diff / 2)
  const r = diff - l
  return ' '.repeat(l) + s + ' '.repeat(r)
}

// Truncate to visible width with ellipsis
export function trunc(s: string, width: number): string {
  if (vw(s) <= width) return s
  let out = ''
  let w = 0
  let i = 0
  while (i < s.length && w < width - 1) {
    const code = s.codePointAt(i)!
    if (code < 0x20) { i++; continue }
    out += String.fromCodePoint(code)
    w++
    i += code > 0xFFFF ? 2 : 1
  }
  return out + '…'
}

// Strip ANSI for measurement
export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
}

// Word-wrap to visible width
export function wrap(s: string, width: number): string[] {
  const lines: string[] = []
  const paragraphs = s.split('\n')
  for (const para of paragraphs) {
    if (para === '') { lines.push(''); continue }
    const words = para.split(/(\s+)/)
    let current = ''
    let currentW = 0
    for (const w of words) {
      const ww = vw(w)
      if (currentW + ww > width) {
        if (current) lines.push(current)
        if (ww > width) {
          // hard break
          let buf = ''
          let bufW = 0
          for (const ch of w) {
            const cw = vw(ch)
            if (bufW + cw > width) { lines.push(buf); buf = ch; bufW = cw }
            else { buf += ch; bufW += cw }
          }
          current = buf
          currentW = bufW
        } else {
          current = w.trimStart()
          currentW = vw(current)
        }
      } else {
        current += w
        currentW += ww
      }
    }
    if (current) lines.push(current)
  }
  return lines
}
