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
      // Not a TTY (e.g. piped input)
      this.rawMode = false
      return
    }
    this.stdin.resume()
    this.stdin.setEncoding('utf8')

    this.stdout.write(ansi.enableBracketedPaste)
    this.stdout.write(ansi.showCursor)

    this.stdin.on('data', this.handleData)
    process.stdout.on('resize', this.handleResize)
  }

  exit() {
    if (!this.rawMode) return
    this.rawMode = false
    this.stdout.write(ansi.disableBracketedPaste)
    this.stdin.setRawMode(false)
    this.stdin.pause()
    this.stdin.off('data', this.handleData)
    process.stdout.off('resize', this.handleResize)
  }

  writeFrame(lines: string[], overlays: string[] = []) {
    // Stub: no-op in scroll-based main buffer mode
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

    // Bracketed paste detection
    if (s.startsWith('\x1b[200~')) {
      const endIdx = s.indexOf('\x1b[201~')
      if (endIdx !== -1) {
        const pastedText = s.slice(8, endIdx)
        const keyEvent: KeyEvent = {
          ctrl: false,
          meta: false,
          shift: false,
          name: 'paste',
          sequence: pastedText,
          raw: s
        }
        for (const h of this.keyHandlers) {
          if (h(keyEvent) === true) return
        }
        return
      }
    }

    // Raw paste / fast typed multi-char printable string
    const hasControlChars = /[\x00-\x08\x0b-\x1f\x7f]/.test(s)
    if (s.length > 1 && !s.includes('\x1b') && !hasControlChars) {
      const keyEvent: KeyEvent = {
        ctrl: false,
        meta: false,
        shift: false,
        name: 'paste',
        sequence: s,
        raw: s
      }
      for (const h of this.keyHandlers) {
        if (h(keyEvent) === true) return
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
  else if (s === '\x1b\x7f' || s === '\x1b\x08') {
    return { ctrl: false, meta: true, shift: false, name: 'backspace', sequence: s, raw: s }
  }
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
