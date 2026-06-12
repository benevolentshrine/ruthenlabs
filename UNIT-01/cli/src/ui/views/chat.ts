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
  model?: string
  workingDir?: string
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
  return `${Math.round(seconds)}s`
}

function applyBgColor(line: string, bgCode: string, width: number): string {
  const padded = pad(line, width)
  const restored = padded.replace(/\x1b\[0?m/g, `\x1b[0m${bgCode}`)
  return `${bgCode}${restored}${ansi.reset}`
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
      model: '',
      workingDir: '',
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

  buildWelcomeBlock(W: number): { msgId: string; kind: 'system'; hasThought: boolean; lines: string[] } {
    const lines: string[] = []
    const leftW = 34
    // Calculate right width based on border layout
    const rightW = Math.max(20, W - 9 - leftW)

    const borderCol = ansi.fg(colors.border)
    const reset = ansi.reset
    const warnCol = ansi.fg(colors.warn)
    const textMuted = ansi.fg(colors.textMuted)
    const bold = ansi.bold

    // Header border with title blocks
    const titleL = `── Unit-01 v0.1.0 `
    const titleR = `── Tips & Info `
    const topBorder = `  ${borderCol}┌${titleL}${'─'.repeat(Math.max(0, leftW + 2 - titleL.length))}┬${titleR}${'─'.repeat(Math.max(0, rightW + 2 - titleR.length))}┐${reset}`
    lines.push(topBorder)

    // Left column content (centered): Welcome message and mascot
    const leftLines = [
      '',
      `${bold}Welcome back!${reset}`,
      '',
      `${warnCol}   ▄▀     ▀▄   ${reset}`,
      `${warnCol}  ▄█████████▄  ${reset}`,
      `${warnCol} ███ █ █ █ ███ ${reset}`,
      `${warnCol} █████████████ ${reset}`,
      `${warnCol}   █ █▀▀▀█ █   ${reset}`,
      '',
      `${textMuted}model:${reset} ${this.state.model ? trunc(this.state.model, 20) : 'no model'}`,
      `${textMuted}dir:${reset} ${trunc(this.state.workingDir ? (this.state.workingDir.split('/').pop() || 'workspace') : 'workspace', 20)}`
    ]

    // Right column content (left-aligned): Tips and release features
    const rightLines = [
      `${bold}Tips for getting started${reset}`,
      `${ansi.fg(colors.unit)}/model${reset}  switch LLM models`,
      `${ansi.fg(colors.unit)}/doctor${reset} check status of LSP indexer`,
      `${ansi.fg(colors.unit)}/index${reset}  re-index current workspace`,
      `${ansi.fg(colors.unit)}/new${reset}    clear history and start fresh`,
      `${borderCol}${'─'.repeat(rightW + 2)}${reset}`,
      `${bold}What's new${reset}`,
      `Borderless Claude-style terminal theme`,
      `Thinking spinner & elapsed timer anim`,
      `Toggle thoughts inline via ${bold}ctrl+o${reset}`,
      `Added paste and word-deletion support`
    ]

    const maxLines = Math.max(leftLines.length, rightLines.length)
    const divChar = `${borderCol}│${reset}`

    for (let i = 0; i < maxLines; i++) {
      const leftRaw = leftLines[i] ?? ''
      const rightRaw = rightLines[i] ?? ''
      
      const leftPadded = pad(leftRaw, leftW, 'center')
      const rightPadded = pad(rightRaw, rightW, 'left')
      
      lines.push(`  ${divChar} ${leftPadded} ${divChar} ${rightPadded} ${divChar}`)
    }

    const bottomBorder = `  ${borderCol}└${'─'.repeat(leftW + 2)}┴${'─'.repeat(rightW + 2)}┘${reset}`
    lines.push(bottomBorder)

    return { msgId: 'welcome', kind: 'system', hasThought: false, lines }
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
    const inner = W - 4  // borderless, wider content area

    // Add Welcome/Mascot block at the very top
    blocks.push(this.buildWelcomeBlock(W))

    for (const m of this.state.messages) {
      if (m.role === 'system') continue
      if (m.role === 'tool') continue  // tool results are visualized in tool cards
      if (m.role === 'user') {
        const wrapW = W - 4
        const rendered = renderMarkdown(m.content, wrapW - 2)
        const lines: string[] = []
        const bgCode = ansi.bg(colors.bgHi)
        const reset = ansi.reset
        
        lines.push('')
        for (let i = 0; i < rendered.length; i++) {
          const prefix = i === 0 ? `${ansi.fg(colors.textDim)}❯${reset} ` : '  '
          const rawLine = prefix + rendered[i]
          lines.push(applyBgColor(rawLine, bgCode, W))
        }
        lines.push('')
        blocks.push({ msgId: m.id, kind: 'user', hasThought: false, lines })
      } else if (m.role === 'assistant') {
        const { thought, response, isThinking } = parseThoughts(m.content)
        const lines: string[] = []
        let hasThought = false

        if (thought || isThinking) {
          hasThought = true
          const collapsed = !isThinking && !this.state.expandedThoughts.has(m.id)
          const duration = m.thoughtDuration ?? 1.0
          const durationStr = formatDuration(duration)
          
          let headerLine = ''
          if (isThinking) {
            const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]
            headerLine = `  ${ansi.fg(colors.textDim)}${ansi.dim}Thought for ${durationStr}...${ansi.reset}`
          } else {
            const actionStr = collapsed ? 'expand' : 'collapse'
            headerLine = `  ${ansi.fg(colors.textDim)}${ansi.dim}Thought for ${durationStr} (ctrl+o to ${actionStr})${ansi.reset}`
          }
          
          lines.push(headerLine)
          
          if (!collapsed && thought) {
            const renderedThought = renderMarkdown(thought, W - 6)
            for (const l of renderedThought) {
              lines.push(`  ${ansi.fg(colors.textDim)}${ansi.dim}${ansi.italic}│ ${l}${ansi.reset}`)
            }
            lines.push('') // spacer
          }
        }

        if (response) {
          const rendered = renderMarkdown(response, W - 4)
          for (let i = 0; i < rendered.length; i++) {
            const prefix = i === 0 ? `${ansi.fg(colors.asst)}●${ansi.reset} ` : '  '
            lines.push(`  ${prefix}${rendered[i]}`)
          }
        }

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
      
      if (thought || isThinking) {
        hasThought = true
        let headerLine = ''
        
        if (isThinking) {
          const elapsed = (Date.now() - this.state.thoughtStartTime) / 1000
          const durationStr = formatDuration(elapsed)
          const spinner = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]
          headerLine = `  ${ansi.fg(colors.warn)}${spinner}${ansi.reset} ${ansi.fg(colors.textDim)}${ansi.dim}Thinking (${durationStr})...${ansi.reset}`
          lines.push(headerLine)
        } else {
          // Finished thinking but still streaming response
          const elapsed = (Date.now() - this.state.thoughtStartTime) / 1000
          const durationStr = formatDuration(elapsed)
          const collapsed = !this.state.expandedThoughts.has('streaming')
          const actionStr = collapsed ? 'expand' : 'collapse'
          headerLine = `  ${ansi.fg(colors.textDim)}${ansi.dim}Thought for ${durationStr} (ctrl+o to ${actionStr})${ansi.reset}`
          lines.push(headerLine)
          
          if (!collapsed && thought) {
            const renderedThought = renderMarkdown(thought, W - 6)
            for (const l of renderedThought) {
              lines.push(`  ${ansi.fg(colors.textDim)}${ansi.dim}${ansi.italic}│ ${l}${ansi.reset}`)
            }
            lines.push('') // spacer
          }
        }
      }

      if (response) {
        const rendered = renderMarkdown(response, W - 4)
        for (let i = 0; i < rendered.length; i++) {
          const prefix = i === 0 ? `${ansi.fg(colors.asst)}●${ansi.reset} ` : '  '
          lines.push(`  ${prefix}${rendered[i]}`)
        }
      }

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
