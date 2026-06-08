import { ansi, colors, pad, trunc, vw, SPINNER, wrap } from '../../util/ansi.js'
import type { ToolCall } from '../../types.js'
import { TOOL_META } from '../../llm/tools.js'
import { renderSideBySideDiff } from '../../diff-renderer.js'
import { renderMarkdown } from '../../markdown.js'
import pc from 'picocolors'

const STATUS_ICON: Record<string, { icon: string; color: number }> = {
  pending:   { icon: '◌', color: colors.textMuted },
  approved:  { icon: '◓', color: colors.warn },
  running:   { icon: '◓', color: colors.warn },
  done:      { icon: '▣', color: colors.ok },
  error:     { icon: '⃠', color: colors.error },
  denied:    { icon: '⊘', color: colors.textMuted },
}

export function renderToolCard(tc: ToolCall, collapsed = false, width = 80): string[] {
  const meta = TOOL_META[tc.name] ?? { risk: 'moderate' as const, category: 'read' as const, description: tc.name }
  const status = { ...STATUS_ICON[tc.status] }
  if (tc.status === 'running') {
    status.icon = SPINNER[Math.floor(Date.now() / 80) % SPINNER.length]
  }

  const argsSummary = summarizeArgs(tc.args)
  const durationStr = tc.durationMs !== undefined ? `${(tc.durationMs / 1000).toFixed(1)}s` : ''

  // Header line
  const header = `  ${ansi.fg(status.color)}${status.icon}${ansi.reset} ${ansi.fg(colors.text)}${ansi.bold}${tc.name}${ansi.reset} ${ansi.fg(colors.textMuted)}· ${argsSummary}${durationStr ? ` · ${durationStr}` : ''}${ansi.reset}`

  const lines: string[] = [header]

  if (!collapsed) {
    const bodyLines: string[] = []

    if (tc.name === 'write_file' || tc.name === 'patch_file') {
      const original = tc.originalContent ?? ''
      const updated = tc.name === 'write_file'
        ? (tc.args.content as string ?? '')
        : (original.includes(tc.args.target as string) ? original.replace(tc.args.target as string, tc.args.replacement as string) : original)

      if (original === '') {
        const path = tc.args.path as string
        const ext = path ? path.split('.').pop() ?? '' : ''
        const lang = ext || 'text'
        const markdownContent = `\`\`\`${lang}\n${updated}\n\`\`\``
        const rendered = renderMarkdown(markdownContent, width - 8)
        bodyLines.push(...rendered)
      } else {
        const diffLines = renderSideBySideDiff(original, updated, width - 8)
        const maxDiffLines = 15
        bodyLines.push(...diffLines.slice(0, maxDiffLines))
        if (diffLines.length > maxDiffLines) {
          bodyLines.push(pc.dim('…'))
        }
      }
    } else if (tc.name === 'read_file' && tc.result) {
      const path = tc.args.path as string
      const ext = path ? path.split('.').pop() ?? '' : ''
      const lang = ext || 'text'
      const markdownContent = `\`\`\`${lang}\n${tc.result}\n\`\`\``
      const rendered = renderMarkdown(markdownContent, width - 8)
      bodyLines.push(...rendered)
    } else if (tc.name === 'web_search' && tc.result) {
      try {
        const results = JSON.parse(tc.result) as { title: string; url: string; content: string }[]
        const topResults = results.slice(0, 4)
        for (let i = 0; i < topResults.length; i++) {
          const r = topResults[i]
          const titleLine = `${ansi.bold}${ansi.fg(colors.unit)}${r.title || 'No Title'}${ansi.reset}`
          const urlLine = r.url ? ` ${ansi.fg(colors.textDim)}${r.url}${ansi.reset}` : ''
          bodyLines.push(titleLine + urlLine)
          
          if (r.content) {
            const wrappedContent = wrap(r.content, width - 12)
            const linesToShow = wrappedContent.slice(0, 2)
            for (const line of linesToShow) {
              bodyLines.push(`  ${ansi.fg(colors.textDim)}${line}${ansi.reset}`)
            }
          }
          if (i < topResults.length - 1) {
            bodyLines.push('')
          }
        }
      } catch (e) {
        bodyLines.push(`${ansi.fg(colors.error)}Failed to parse search results: ${e}${ansi.reset}`)
        bodyLines.push(tc.result)
      }
    } else {
      // Args
      const argsStr = JSON.stringify(tc.args, null, 2)
      if (argsStr.length < 500) {
        bodyLines.push(...argsStr.split('\n').slice(0, 8).map(l => `${ansi.fg(colors.textDim)}${trunc(l, width - 8)}${ansi.reset}`))
        if (argsStr.split('\n').length > 8) {
          bodyLines.push(`${ansi.fg(colors.textMuted)}…${ansi.reset}`)
        }
      }

      // Result
      if (tc.result) {
        const preview = tc.result.length > 600 ? tc.result.slice(0, 600) + '…' : tc.result
        const resultLines = preview.split('\n').slice(0, 15)
        bodyLines.push(`${ansi.fg(colors.textMuted)}→ result (${tc.result.length} chars):${ansi.reset}`)
        bodyLines.push(...resultLines.map(l => `${ansi.fg(colors.textDim)}${trunc(l, width - 8)}${ansi.reset}`))
        if (preview.split('\n').length > 15) {
          bodyLines.push(`${ansi.fg(colors.textMuted)}…${ansi.reset}`)
        }
      }
    }

    if (tc.error) {
      bodyLines.push(`${ansi.fg(colors.error)}✗ ${tc.error}${ansi.reset}`)
    }

    if (bodyLines.length > 0) {
      const panelWidth = width - 4
      const bgCode = ansi.bg(colors.bgLight)

      lines.push(`${bgCode}${' '.repeat(panelWidth)}${ansi.reset}`)
      for (const bl of bodyLines) {
        const indented = `  ${bl}`
        lines.push(`${bgCode}${pad(indented, panelWidth)}${ansi.reset}`)
      }
      lines.push(`${bgCode}${' '.repeat(panelWidth)}${ansi.reset}`)
    }
  }

  return lines
}

function summarizeArgs(args: Record<string, unknown>): string {
  const priorityKeys = [
    'path', 'TargetFile', 'AbsolutePath',
    'command', 'CommandLine',
    'query', 'Query'
  ]
  
  for (const pk of priorityKeys) {
    if (pk in args && args[pk] !== undefined) {
      const v = args[pk]
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return trunc(`${pk}=${s}`, 60)
    }
  }

  const excludeKeys = new Set([
    'content', 'replacement', 'target',
    'ReplacementContent', 'TargetContent', 'CodeContent'
  ])

  const filteredEntries = Object.entries(args).filter(([k]) => !excludeKeys.has(k))

  if (filteredEntries.length === 0) return ''
  if (filteredEntries.length === 1) {
    const [k, v] = filteredEntries[0]
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return trunc(`${k}=${s}`, 60)
  }
  return trunc(filteredEntries.map(([k, v]) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v)
    return `${k}=${trunc(s, 20)}`
  }).join(' '), 60)
}
