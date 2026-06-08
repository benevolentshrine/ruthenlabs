import { ansi, colors, stripAnsi } from '../util/ansi.js'
import type { KeyEvent } from '../types.js'

export type Frame = string[]  // array of lines, one per terminal row

export interface Size {
  cols: number
  rows: number
}

export class TUI {
  private stdout: NodeJS.WriteStream = process.stdout
  private stdin: NodeJS.ReadStream = process.stdin
  private listeners: Set<() => void> = new Set()
  private keyHandlers: Set<(k: KeyEvent) => boolean | void> = new Set()
  private rawMode = false
  private altScreen = false
  private size: Size = { cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 }
  private mouseHandlers: Set<(btn: number, x: number, y: number) => boolean | void> = new Set()
  private resizeHandlers: Set<(s: Size) => void> = new Set()
  private lastFrameRows = 0
  private lastFrameWidth = 0

  getSize(): Size { return this.size }
  onKey(h: (k: KeyEvent) => boolean | void) { this.keyHandlers.add(h); return () => this.keyHandlers.delete(h) }
  onMouse(h: (btn: number, x: number, y: number) => boolean | void) { this.mouseHandlers.add(h); return () => this.mouseHandlers.delete(h) }
  onResize(h: (s: Size) => void) { this.resizeHandlers.add(h); return () => this.resizeHandlers.delete(h) }
  onRender(h: () => void) { this.listeners.add(h); return () => this.listeners.delete(h) }

  enter() {
    if (this.rawMode) return
    this.rawMode = true
    try {
      this.stdin.setRawMode(true)
    } catch (e) {
      // Not a TTY (e.g. piped input) — TUI will be read-only
      this.rawMode = false
      return
    }
    this.stdin.resume()
    this.stdin.setEncoding('utf8')

    this.stdout.write(ansi.enterAltScreen)
    // Force dark grey default background so the TUI looks the same regardless of
    // the host terminal's color scheme. OSC 11 sets the default background.
    this.stdout.write('\x1b]11;#080808\x07')
    this.stdout.write(ansi.enableMouse)
    this.stdout.write(ansi.enableBracketedPaste)
    this.stdout.write(ansi.hideCursor)
    this.stdout.write(ansi.clearScreen)
    this.altScreen = true

    this.stdin.on('data', this.handleData)
    process.stdout.on('resize', this.handleResize)
  }

  exit() {
    if (!this.rawMode) return
    this.rawMode = false
    this.stdout.write(ansi.showCursor)
    // Reset default background to terminal default
    this.stdout.write('\x1b]111\x07')
    this.stdout.write(ansi.disableMouse)
    this.stdout.write(ansi.disableBracketedPaste)
    this.stdout.write(ansi.exitAltScreen)
    this.altScreen = false
    this.stdin.setRawMode(false)
    this.stdin.pause()
    this.stdin.off('data', this.handleData)
    process.stdout.off('resize', this.handleResize)
  }

  writeFrame(lines: string[], overlays: string[] = []) {
    let out = ansi.moveTo(1, 1)
    const bgCode = `\x1b[48;5;${colors.bg}m` // Solid dark grey background
    const dimFgCode = '\x1b[38;5;237m' // Very dark grey for blurred background text
    const hasOverlay = overlays.length > 0

    for (let i = 0; i < lines.length; i++) {
      if (i > 0) out += '\r\n'
      const line = lines[i] ?? ''
      
      let escaped: string
      if (hasOverlay) {
        // Blur/dim effect: strip ANSI styles and render in uniform dark grey
        const clean = stripAnsi(line)
        escaped = `${dimFgCode}${clean}`
      } else {
        // Escape resets to preserve the solid background color
        escaped = line.replace(/\x1b\[0m/g, `\x1b[0m${bgCode}`)
      }
      out += `${bgCode}${escaped}\x1b[K`
    }

    // If the new frame is shorter than the previous one, clear the leftover rows
    const rows = this.size.rows
    const written = Math.min(lines.length, rows)
    if (this.lastFrameRows > written) {
      for (let i = written; i < this.lastFrameRows; i++) {
        out += `\r\n${bgCode}\x1b[K`
      }
    }

    // Write overlays (they have their own moveTo positioning)
    const overlayBg = `\x1b[48;5;${colors.bgLight}m`
    for (const overlay of overlays) {
      const escaped = overlay.replace(/\x1b\[0m/g, `\x1b[0m${overlayBg}`)
      out += escaped
    }

    // Reset all attributes so style state doesn't leak
    out += ansi.reset

    this.lastFrameRows = written
    this.lastFrameWidth = this.size.cols
    this.stdout.write(out)
  }

  reset() {
    this.lastFrameRows = 0
    this.lastFrameWidth = 0
    this.stdout.write(ansi.clearScreen + ansi.moveTo(1, 1) + ansi.reset)
  }

  private handleResize = () => {
    this.size = { cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 }
    // Hard reset the screen on resize — the previous frame may have left
    // content at rows that no longer exist.
    this.lastFrameRows = 0
    this.stdout.write(ansi.clearScreen + ansi.moveTo(1, 1) + ansi.reset)
    for (const h of this.resizeHandlers) h(this.size)
    for (const h of this.listeners) h()
  }

  private handleData = (data: Buffer) => {
    const s = data.toString('utf8')

    // SGR mouse: ESC[<btn;col;rowM or m
    const mouseMatch = s.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/)
    if (mouseMatch) {
      const btn = parseInt(mouseMatch[1])
      const x = parseInt(mouseMatch[2])
      const y = parseInt(mouseMatch[3])
      for (const h of this.mouseHandlers) {
        if (h(btn, x, y) === true) return
      }
      return
    }

    // Parse key
    const key = parseKey(s)
    if (key) {
      for (const h of this.keyHandlers) {
        if (h(key) === true) return
      }
    }
  }
}

export function parseKey(s: string): KeyEvent | null {
  if (s.length === 0) return null
  const isCtrlChar = s.length === 1 && s.charCodeAt(0) < 0x20
  const ctrl = isCtrlChar
  const meta = s.length > 1 && s.includes('\x1b')
  let shift = false
  let name: string | null = null
  const sequence = s

  if (s === '\r' || s === '\n') name = 'enter'
  else if (s === '\t') name = 'tab'
  else if (s === '\x7f' || s === '\b') name = 'backspace'
  else if (s === '\x1b') name = 'escape'
  else if (s === ' ') name = 'space'
  else if (isCtrlChar) {
    // Map control characters to their canonical letter name
    // 0x01=a, 0x02=b, ..., 0x1A=z. CR/LF/TAB/DEL are handled above.
    const code = s.charCodeAt(0)
    if (code >= 0x01 && code <= 0x1a) {
      name = String.fromCharCode(code + 0x60)
    } else {
      name = s
    }
  }
  else if (s.length === 1) name = s
  else if (s === '\x1b[A' || s === '\x1bOA') name = 'up'
  else if (s === '\x1b[B' || s === '\x1bOB') name = 'down'
  else if (s === '\x1b[C' || s === '\x1bOC') name = 'right'
  else if (s === '\x1b[D' || s === '\x1bOD') name = 'left'
  else if (s === '\x1b[H' || s === '\x1bOH') name = 'home'
  else if (s === '\x1b[F' || s === '\x1bOF') name = 'end'
  else if (s === '\x1b[5~') name = 'pageup'
  else if (s === '\x1b[6~') name = 'pagedown'
  else if (s === '\x1b[3~') name = 'delete'
  else if (s === '\x1b[Z') { shift = true; name = 'tab' }
  else if (s.startsWith('\x1b[1;')) {
    // modified key: ESC[1;modX where mod is 1+modifier bits (1=shift, 2=alt, 4=ctrl, 8=meta)
    // and X is the key code letter
    const m = s.match(/^\x1b\[1;(\d+)(.)$/)
    if (m) {
      const mod = parseInt(m[1])
      const k = m[2]
      shift = !!(mod & 1)
      const c = !!(mod & 4)
      const a = !!(mod & 2)
      if (k === 'A') name = 'up'
      else if (k === 'B') name = 'down'
      else if (k === 'C') name = 'right'
      else if (k === 'D') name = 'left'
      else if (k === 'H') name = 'home'
      else if (k === 'F') name = 'end'
      else if (k === '~') name = 'enter'
      if (name) return { ctrl: c, meta: a, shift, name, sequence: s, raw: s }
    }
    return { ctrl, meta, shift, name: null, sequence: s, raw: s }
  } else if (s.length > 1 && s.charCodeAt(0) < 0x20) {
    name = s.slice(1)
  }

  return { ctrl, meta, shift, name, sequence: s, raw: s }
}
