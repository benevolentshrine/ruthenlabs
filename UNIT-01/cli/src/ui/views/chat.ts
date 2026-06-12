// ── Chat view: main streaming chat with tool calls ───────────────────

import { ansi, colors, pad, trunc, vw, wrap, SPINNER } from '../../util/ansi.js'
import { renderMarkdown } from '../../markdown.js'
import { renderToolsPanel } from '../widgets/tool-card.js'
import type { ChatMessage, ToolCall } from '../../types.js'

export interface ChatViewState {
  messages: ChatMessage[]
  streamingText: string
  currentToolCalls: ToolCall[]
  collapsedTools: Set<string>  // tool call ids
  expandedThoughts: Set<string> // message ids
  thoughtStartTime: number
  followMode: boolean
  scrollOffset: number  // 0 = bottom
  viewHeight: number    // available content rows
  viewWidth: number
}

export interface ParsedThoughts {
  thought: string
  response: string
  isThinking: boolean
}

export function formatDuration(seconds: number): string {
  if (seconds < 1.0) {
    return `${Math.round(seconds * 1000)}ms`
  }
  return `${seconds.toFixed(1)}s`
}


export function parseThoughts(content: string): ParsedThoughts {
  const startTag = '<think>'
  const endTag = '</think>'
  const startIdx = content.indexOf(startTag)
  if (startIdx !== -1) {
    const endIdx = content.indexOf(endTag)
    if (endIdx !== -1) {
      return {
        thought: content.slice(startIdx + startTag.length, endIdx).trim(),
        response: content.slice(endIdx + endTag.length).trim(),
        isThinking: false,
      }
    } else {
      return {
        thought: content.slice(startIdx + startTag.length).trim(),
        response: '',
        isThinking: true,
      }
    }
  }
  return { thought: '', response: content, isThinking: false }
}

export class ChatView {
  state: ChatViewState
  thoughtHeaderRows: Map<number, string> = new Map() // terminal row -> message id
  toolsHeaderRows: Map<number, string> = new Map() // terminal row -> message id/toolsKey

  constructor() {
    this.state = {
      messages: [],
      streamingText: '',
      currentToolCalls: [],
      collapsedTools: new Set(),
      expandedThoughts: new Set(),
      thoughtStartTime: 0,
      followMode: true,
      scrollOffset: 0,
      viewHeight: 20,
      viewWidth: 80,
    }
  }

  setSize(w: number, h: number) {
    this.state.viewWidth = w
    this.state.viewHeight = h
  }

  appendMessage(m: ChatMessage) {
    if (!this.state.messages.includes(m)) {
      this.state.messages.push(m)
    }
    this.state.followMode = true
    this.state.scrollOffset = 0
  }

  setStreaming(text: string) {
    this.state.streamingText = text
    this.state.followMode = true
    this.state.scrollOffset = 0
  }

  appendToolCall(tc: ToolCall) {
    if (!this.state.currentToolCalls.includes(tc)) {
      this.state.currentToolCalls.push(tc)
    }
    this.state.followMode = true
    this.state.scrollOffset = 0
  }

  updateToolCall(tc: ToolCall) {
    const i = this.state.currentToolCalls.findIndex(t => t.id === tc.id)
    if (i >= 0) this.state.currentToolCalls[i] = tc
  }

  clearStreaming() {
    this.state.streamingText = ''
    this.state.currentToolCalls = []
  }

  toggleCollapse(tcId: string) {
    if (this.state.collapsedTools.has(tcId)) this.state.collapsedTools.delete(tcId)
    else this.state.collapsedTools.add(tcId)
  }

  toggleThought(msgId: string) {
    if (this.state.expandedThoughts.has(msgId)) {
      this.state.expandedThoughts.delete(msgId)
    } else {
      this.state.expandedThoughts.add(msgId)
    }
  }

  // Returns the total rendered line count for the current state
  totalLines(): number {
    const blocks = this.buildBlocks()
    return blocks.reduce((n, b) => n + b.lines.length + 1, 0)
  }

  // Build the visual blocks
  buildBlocks(): { msgId: string; kind: 'user' | 'assistant' | 'system' | 'tool' | 'spacer'; hasThought: boolean; lines: string[] }[] {
    const blocks: { msgId: string; kind: 'user' | 'assistant' | 'system' | 'tool' | 'spacer'; hasThought: boolean; lines: string[] }[] = []
    const W = this.state.viewWidth
    const inner = W - 8  // account for left/right borders and margins

    for (const m of this.state.messages) {
      if (m.role === 'system') continue
      if (m.role === 'tool') continue  // tool results are visualized in tool cards
      if (m.role === 'user') {
        const wrapW = W - 8
        const rendered = renderMarkdown(m.content, wrapW)
        const lines: string[] = []
        
        const topBorder = `  ┌─ ${ansi.fg(colors.borderHi)}You${ansi.reset} ${'─'.repeat(Math.max(0, W - 12))}┐`
        const bottomBorder = `  └${'─'.repeat(Math.max(0, W - 6))}┘`
        const sideBorder = `${ansi.fg(colors.border)}│${ansi.reset}`

        lines.push('', topBorder)
        for (const l of rendered) {
          lines.push(`  ${sideBorder} ${pad(l, wrapW)} ${sideBorder}`)
        }
        lines.push(bottomBorder)
        blocks.push({ msgId: m.id, kind: 'user', hasThought: false, lines })
      } else if (m.role === 'assistant') {
        const { thought, response, isThinking } = parseThoughts(m.content)
        const lines: string[] = []
        let hasThought = false

        const topBorder = `  ┌─ ${ansi.fg(colors.asst)}Unit-01${ansi.reset} ${'─'.repeat(Math.max(0, W - 16))}┐`
        const bottomBorder = `  └${'─'.repeat(Math.max(0, W - 6))}┘`
        const sideBorder = `${ansi.fg(colors.border)}│${ansi.reset}`

        lines.push('', topBorder)

        if (thought || isThinking) {
          hasThought = true
          const collapsed = !isThinking && !this.state.expandedThoughts.has(m.id)
          const duration = m.thoughtDuration ?? 1.0
          const durationStr = formatDuration(duration)
          
          let headerLine = ''
          if (isThinking) {
            const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]
            headerLine = `${ansi.fg(colors.warn)}${ansi.bold}${spinner} Thought: ${durationStr}${ansi.reset}`
          } else {
            const sign = collapsed ? '+' : '–'
            headerLine = `${ansi.fg(colors.warn)}${ansi.bold}${sign} Thought: ${durationStr}${ansi.reset}`
          }
          
          lines.push(`  ${sideBorder} ${pad(headerLine, inner)} ${sideBorder}`)
          
          if (!collapsed) {
            const renderedThought = renderMarkdown(thought, W - 10)
            for (const l of renderedThought) {
              lines.push(`  ${sideBorder} ${pad(`${ansi.fg(colors.textDim)}${ansi.dim}${ansi.italic}${l}${ansi.reset}`, inner)} ${sideBorder}`)
            }
            lines.push(`  ${sideBorder} ${pad('', inner)} ${sideBorder}`) // spacer
          }
        }

        if (response) {
          const rendered = renderMarkdown(response, inner)
          for (const l of rendered) {
            lines.push(`  ${sideBorder} ${pad(l, inner)} ${sideBorder}`)
          }
        }

        lines.push(bottomBorder)
        blocks.push({ msgId: m.id, kind: 'assistant', hasThought, lines })

        // tool call cards
        if (m.toolCalls && m.toolCalls.length > 0) {
          const toolsKey = `${m.id}-tools`
          const isCollapsed = !this.state.collapsedTools.has(toolsKey)
          const cardLines = renderToolsPanel(m.id, m.toolCalls, isCollapsed, W)
          blocks.push({ msgId: toolsKey, kind: 'tool', hasThought: false, lines: cardLines })
        }
      }
    }

    // Streaming assistant
    if (this.state.streamingText) {
      const { thought, response, isThinking } = parseThoughts(this.state.streamingText)
      const lines: string[] = []
      let hasThought = false
      
      const topBorder = `  ┌─ ${ansi.fg(colors.asst)}Unit-01${ansi.reset} ${'─'.repeat(Math.max(0, W - 16))}┐`
      const bottomBorder = `  └${'─'.repeat(Math.max(0, W - 6))}┘`
      const sideBorder = `${ansi.fg(colors.border)}│${ansi.reset}`

      lines.push('', topBorder)

      if (thought || isThinking) {
        hasThought = true
        const elapsed = (Date.now() - this.state.thoughtStartTime) / 1000
        const durationStr = formatDuration(elapsed)
        const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]
        const headerLine = `${ansi.fg(colors.warn)}${ansi.bold}${spinner} Thought: ${durationStr}${ansi.reset}`

        lines.push(`  ${sideBorder} ${pad(headerLine, inner)} ${sideBorder}`)
        
        // Always expanded while thinking
        const renderedThought = renderMarkdown(thought, W - 10)
        for (const l of renderedThought) {
          lines.push(`  ${sideBorder} ${pad(`${ansi.fg(colors.textDim)}${ansi.dim}${ansi.italic}${l}${ansi.reset}`, inner)} ${sideBorder}`)
        }
        if (!isThinking) {
          lines.push(`  ${sideBorder} ${pad('', inner)} ${sideBorder}`)
        }
      }

      if (response) {
        const rendered = renderMarkdown(response, inner)
        for (const l of rendered) {
          lines.push(`  ${sideBorder} ${pad(l, inner)} ${sideBorder}`)
        }
      }

      lines.push(bottomBorder)
      blocks.push({ msgId: 'streaming', kind: 'assistant', hasThought, lines })
    } else if (this.state.currentToolCalls.length > 0) {
      // Currently running tool calls
      const toolsKey = 'current-tools'
      const isCollapsed = this.state.collapsedTools.has(toolsKey)
      const cardLines = renderToolsPanel('current', this.state.currentToolCalls, isCollapsed, W)
      blocks.push({ msgId: toolsKey, kind: 'tool', hasThought: false, lines: cardLines })
    }

    return blocks
  }

  render(): string[] {
    const blocks = this.buildBlocks()
    const allLines: string[] = []
    const allMeta: { msgId?: string; isThoughtHeader?: boolean; isToolsHeader?: boolean }[] = []

    for (const b of blocks) {
      for (let i = 0; i < b.lines.length; i++) {
        allLines.push(b.lines[i])
        const isHeader = b.kind === 'assistant' && b.hasThought && i === 0
        const isTools = b.kind === 'tool' && i === 1
        allMeta.push({ msgId: b.msgId, isThoughtHeader: isHeader, isToolsHeader: isTools })
      }
      allLines.push('')
      allMeta.push({})
    }

    const total = allLines.length
    const maxOffset = Math.max(0, total - this.state.viewHeight)
    
    if (this.state.followMode) {
      this.state.scrollOffset = 0
    } else {
      this.state.scrollOffset = Math.max(0, Math.min(this.state.scrollOffset, maxOffset))
    }

    const start = Math.max(0, total - this.state.viewHeight - this.state.scrollOffset)
    const end = Math.min(total, start + this.state.viewHeight)
    
    // Set absolute row mappings for clicks
    this.thoughtHeaderRows.clear()
    const visibleLines = allLines.slice(start, end)
    const visibleMeta = allMeta.slice(start, end)

    for (let i = 0; i < visibleLines.length; i++) {
      const meta = visibleMeta[i]
      if (meta) {
        if (meta.isThoughtHeader && meta.msgId) {
          this.thoughtHeaderRows.set(3 + i, meta.msgId)
        }
        if (meta.isToolsHeader && meta.msgId) {
          this.toolsHeaderRows.set(3 + i, meta.msgId)
        }
      }
    }

    return visibleLines
  }

  scrollUp(n = 1) {
    const total = this.totalLines()
    const max = Math.max(0, total - this.state.viewHeight)
    if (max === 0) return
    this.state.followMode = false
    this.state.scrollOffset = Math.min(this.state.scrollOffset + n, max)
  }

  scrollDown(n = 1) {
    this.state.scrollOffset = Math.max(0, this.state.scrollOffset - n)
    if (this.state.scrollOffset === 0) {
      this.state.followMode = true
    }
  }

  get canScrollUp() {
    const total = this.totalLines()
    return total > this.state.viewHeight && this.state.scrollOffset < (total - this.state.viewHeight)
  }
  get canScrollDown() {
    return this.state.scrollOffset > 0
  }
}
