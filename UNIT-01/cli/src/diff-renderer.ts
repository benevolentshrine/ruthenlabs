import { diffLines, diffChars, Change } from 'diff'
import pc from 'picocolors'
import { vw, trunc } from './util/ansi.js'

export interface DiffOptions {
  type?: 'lines' | 'chars'
  context?: number
  maxLines?: number
}

const ELLIPSIS = pc.dim('…')

export function computeDiff(original: string, updated: string, options: DiffOptions = {}): Change[] {
  const { type = 'lines' } = options
  if (type === 'chars') {
    return diffChars(original, updated)
  }
  return diffLines(original, updated)
}

export function renderDiff(original: string, updated: string, options: DiffOptions = {}): string {
  const changes = computeDiff(original, updated, options)
  const { maxLines = 200 } = options
  const lines: string[] = []
  let count = 0

  for (const change of changes) {
    const raw = change.value.replace(/\n$/, '')
    if (!raw) continue
    const parts = raw.split('\n')

    for (const part of parts) {
      if (count >= maxLines) {
        lines.push(ELLIPSIS)
        break
      }
      if (change.added) {
        lines.push(pc.green(`+ ${part}`))
      } else if (change.removed) {
        lines.push(pc.red(`- ${part}`))
      } else {
        lines.push(pc.dim(`  ${part}`))
      }
      count++
    }
    if (count >= maxLines) break
  }

  return lines.join('\n')
}

export function renderInlineDiff(original: string, updated: string): string {
  const changes = diffChars(original, updated)
  return changes
    .map(change => {
      if (change.added) return pc.green(change.value)
      if (change.removed) return pc.red(change.value)
      return change.value
    })
    .join('')
}

export interface DiffLine {
  num: number | null
  text: string
  type: 'common' | 'added' | 'removed' | 'empty'
}

export function renderSideBySideDiff(original: string, updated: string, width: number): string[] {
  const changes = diffLines(original, updated)
  const leftLines: DiffLine[] = []
  const rightLines: DiffLine[] = []
  
  let leftLineNum = 1
  let rightLineNum = 1
  
  function align() {
    const max = Math.max(leftLines.length, rightLines.length)
    while (leftLines.length < max) leftLines.push({ num: null, text: '', type: 'empty' })
    while (rightLines.length < max) rightLines.push({ num: null, text: '', type: 'empty' })
  }
  
  for (const change of changes) {
    const value = change.value.replace(/\n$/, '')
    if (!value) continue
    const parts = value.split('\n')
    
    if (change.added) {
      for (const part of parts) {
        rightLines.push({ num: rightLineNum++, text: part, type: 'added' })
      }
    } else if (change.removed) {
      for (const part of parts) {
        leftLines.push({ num: leftLineNum++, text: part, type: 'removed' })
      }
    } else {
      align()
      for (const part of parts) {
        leftLines.push({ num: leftLineNum++, text: part, type: 'common' })
        rightLines.push({ num: rightLineNum++, text: part, type: 'common' })
      }
    }
  }
  
  align()
  
  const colWidth = Math.floor((width - 5) / 2)
  const lines: string[] = []
  
  for (let i = 0; i < leftLines.length; i++) {
    const left = leftLines[i]
    const right = rightLines[i]
    
    let leftFormatted = ''
    if (left.type === 'empty') {
      leftFormatted = ' '.repeat(colWidth)
    } else {
      const numStr = left.num !== null ? left.num.toString().padEnd(5) : '     '
      const prefix = left.type === 'removed' ? '-' : ' '
      const rawLine = `${numStr}${prefix} ${left.text}`
      const truncated = trunc(rawLine, colWidth)
      if (left.type === 'removed') {
        leftFormatted = pc.red(truncated) + ' '.repeat(Math.max(0, colWidth - vw(truncated)))
      } else {
        leftFormatted = pc.dim(truncated) + ' '.repeat(Math.max(0, colWidth - vw(truncated)))
      }
    }
    
    let rightFormatted = ''
    if (right.type === 'empty') {
      rightFormatted = ' '.repeat(colWidth)
    } else {
      const numStr = right.num !== null ? right.num.toString().padEnd(5) : '     '
      const prefix = right.type === 'added' ? '+' : ' '
      const rawLine = `${numStr}${prefix} ${right.text}`
      const truncated = trunc(rawLine, colWidth)
      if (right.type === 'added') {
        rightFormatted = pc.green(truncated) + ' '.repeat(Math.max(0, colWidth - vw(truncated)))
      } else {
        rightFormatted = truncated + ' '.repeat(Math.max(0, colWidth - vw(truncated)))
      }
    }
    
    lines.push(`${leftFormatted} ${pc.gray('│')} ${rightFormatted}`)
  }
  
  return lines
}
