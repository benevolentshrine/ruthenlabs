// ── Input prompt: multi-line, with history, slash interception, ghost text ─

import { ansi, colors, vw } from '../../util/ansi.js'
import type { KeyEvent } from '../../types.js'

export interface InputCallbacks {
  onSubmit: (text: string) => void | Promise<void>
  onChange?: (text: string) => void
  onSlashCommand?: (cmd: string) => boolean | Promise<boolean>  // returns true if handled
  onTab?: (text: string, cursor: number) => Promise<{ items: string[]; apply: (s: string) => void } | null>
  onHistoryUp?: () => string | null
  onHistoryDown?: () => string | null
}

export class InputField {
  private value = ''
  private cursor = 0
  private placeholder = ''
  private multiLine = false
  private cbs: InputCallbacks
  private lastRender = ''
  private focused = true

  constructor(cbs: InputCallbacks) {
    this.cbs = cbs
  }

  setPlaceholder(p: string) { this.placeholder = p }
  getValue() { return this.value }
  setValue(v: string, cursorAt?: number) {
    this.value = v
    this.cursor = cursorAt ?? v.length
    this.cbs.onChange?.(this.value)
  }
  clear() { this.value = ''; this.cursor = 0; this.cbs.onChange?.('') }
  focus() { this.focused = true }
  blur() { this.focused = false }

  renderRaw(ghost = ''): string[] {
    if (!this.value && this.placeholder) {
      const ph = `${ansi.fg(colors.textMuted)}${this.placeholder}${ansi.reset}`
      const gh = ghost ? `${ansi.fg(colors.textMuted)}${ansi.dim}${ghost}${ansi.reset}` : ''
      const cursorChar = this.focused ? `${ansi.inverse} ${ansi.reset}` : ' '
      return [`${cursorChar}${ph}${gh}`]
    }

    const lines = this.value.split('\n')
    const out: string[] = []
    let pos = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineStart = pos
      const lineEnd = pos + line.length
      
      let renderedLine = line
      if (this.cursor >= lineStart && this.cursor <= lineEnd) {
        const idx = this.cursor - lineStart
        const before = line.slice(0, idx)
        const after = line.slice(idx)
        const charAtCursor = after[0] || ' '
        const cursorStr = this.focused ? `${ansi.inverse}${charAtCursor}${ansi.reset}` : charAtCursor
        const rest = after.slice(1)
        const gh = (this.cursor === lineEnd && ghost) ? `${ansi.fg(colors.textMuted)}${ansi.dim}${ghost}${ansi.reset}` : ''
        renderedLine = before + cursorStr + rest + gh
      }
      
      out.push(renderedLine)
      pos = lineEnd + 1
    }
    return out
  }

  // Returns lines for rendering at given width
  render(width: number, ghost = ''): string[] {
    if (!this.focused) return []
    const prompt = `${ansi.fg(colors.unit)}${ansi.bold}▌${ansi.reset}`
    const indent = '  '

    const raw = this.renderRaw(ghost)
    return raw.map((line, i) => {
      if (i === 0) return `${indent}${prompt} ${line}`
      return `${indent}  ${line}`
    })
  }

  // Returns the cursor position as (row, col) within the input
  getCursorPos(): { row: number; col: number } {
    if (!this.value) return { row: 0, col: 3 }  // indent + prompt + space
    const before = this.value.slice(0, this.cursor)
    const lines = before.split('\n')
    const row = lines.length - 1
    const last = lines[lines.length - 1]
    const col = (row === 0 ? 3 : 2) + vw(last)
    return { row, col }
  }

  async handleKey(key: KeyEvent): Promise<boolean> {
    // Printable character: single byte, not a control code, not DEL.
    // This must come BEFORE the switch because parseKey may set `name` to
    // the character itself (e.g. 'a', ' ') which would otherwise fall through.
    if (key.sequence.length === 1) {
      const code = key.sequence.charCodeAt(0)
      if (code >= 0x20 && code !== 0x7f) {
        this.insert(key.sequence)
        return true
      }
    }
    switch (key.name) {
      case 'enter': {
        if (this.value.trim().startsWith('/') && !this.value.includes('\n')) {
          Promise.resolve(this.cbs.onSlashCommand?.(this.value.trim())).then((handled) => {
            if (handled) this.clear()
          })
        } else {
          this.cbs.onSubmit(this.value)
          this.clear()
        }
        return true
      }
      case 'backspace': {
        if (this.cursor > 0) {
          this.value = this.value.slice(0, this.cursor - 1) + this.value.slice(this.cursor)
          this.cursor--
          this.cbs.onChange?.(this.value)
        }
        return true
      }
      case 'delete': {
        if (this.cursor < this.value.length) {
          this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + 1)
          this.cbs.onChange?.(this.value)
        }
        return true
      }
      case 'left': {
        if (this.cursor > 0) this.cursor--
        return true
      }
      case 'right': {
        if (this.cursor < this.value.length) this.cursor++
        return true
      }
      case 'up': {
        const h = this.cbs.onHistoryUp?.()
        if (h !== null && h !== undefined) { this.setValue(h) }
        return true
      }
      case 'down': {
        const h = this.cbs.onHistoryDown?.()
        if (h !== null && h !== undefined) { this.setValue(h) }
        return true
      }
      case 'home': { this.cursor = 0; return true }
      case 'end': { this.cursor = this.value.length; return true }
      case 'tab': {
        if (this.cbs.onTab) {
          const r = await this.cbs.onTab(this.value, this.cursor)
          if (r) r.apply(this.value)
        }
        return true
      }
      default: return false
    }
  }

  private insert(text: string) {
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor)
    this.cursor += text.length
    this.cbs.onChange?.(this.value)
  }
}
