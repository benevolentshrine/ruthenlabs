// ── Boot view: minimal welcome screen (no model picker) ──────────────

import { ansi, colors, pad, vw } from '../../util/ansi.js'
import { renderFiglet, renderTagline } from '../widgets/logo.js'
import type { ModelInfo } from '../../types.js'

export interface BootViewState {
  models: ModelInfo[]
  index: number
  ollamaRunning: boolean
  indexerRunning: boolean
  sandboxRunning: boolean
  workingDir: string
  projectInfo: { files: number; lines: number } | null
  loading: boolean
  model?: string | null
}

function renderSprite(grid: string[], bgCol: number): string[] {
  const lines: string[] = []
  const bgCode = `\x1b[48;5;${bgCol}m  `
  const COLOR_MAP: Record<string, string> = {
    '.': bgCode,
    'k': '\x1b[48;5;16m  ', // black
    'y': '\x1b[48;5;220m  ', // Pikachu yellow
    'r': '\x1b[48;5;196m  ', // red cheeks
    'w': '\x1b[48;5;231m  ', // white eyes
    'b': '\x1b[48;5;94m  ', // brown
  }

  for (const row of grid) {
    let rowStr = ''
    const cells = row.trim().split(/\s+/)
    for (const cell of cells) {
      rowStr += COLOR_MAP[cell] || bgCode
    }
    lines.push(rowStr)
  }
  return lines
}

export function renderBootView(state: BootViewState, width: number, height: number): string[] {
  const lines: string[] = []

  if (!state.ollamaRunning) {
    const PIKACHU_F1 = [
      ". . . . . k k . . . . k k . . .",
      ". . . . k y y k . . k y y k . .",
      ". . . . k y y k . . k y y k . .",
      ". . . . . k y y k k y y k . . .",
      ". . . . . . k y y y y y k . . .",
      ". . . . k k y y y y y y y k k .",
      ". . . k y y y y y y y y y y y k",
      ". . k y y k y y y y y y k y y k",
      ". . k y k w k y y y y k w k y k",
      ". k y y k k y y k y y k k y y k",
      ". k y r y y y y k y y y y r y k",
      ". k y r r y y y y y y y r r y k",
      ". . k y y y y y k k y y y y k .",
      ". . . k y y y y y y y y y k . .",
      ". . . k y y y y y y y y y k . .",
      ". . . . k k k k k k k k k . . ."
    ]

    const PIKACHU_F2 = [
      ". . . . . k k . . . . . . . . .",
      ". . . . k y y k . . . k k . . .",
      ". . . . k y y k . . k y y k . .",
      ". . . . . k y y k k y y k . . .",
      ". . . . . . k y y y y y k . . .",
      ". . . . k k y y y y y y y k k .",
      ". . . k y y y y y y y y y y y k",
      ". . k y y k y y y y y y y y y k",
      ". . k y k w k y y y y y k y y k",
      ". k y y k k y y k y y y k y y k",
      ". k y r y y y y k y y y y r y k",
      ". k y r r y y y y y y y r r y k",
      ". . k y y y y y k k y y y y k .",
      ". . . k y y y y y y y y y k . .",
      ". . . k y y y y y y y y y k . .",
      ". . . . k k k k k k k k k . . ."
    ]

    const frameIdx = state.index % 2
    const currentGrid = frameIdx === 0 ? PIKACHU_F1 : PIKACHU_F2
    const spriteLines = renderSprite(currentGrid, colors.bg)

    // Vertical centering
    const contentH = spriteLines.length + 4
    const topPad = Math.max(2, Math.floor((height - contentH) / 2))
    for (let i = 0; i < topPad; i++) lines.push('')

    // Center Pikachu lines
    const spriteW = 32 // 16 pixels * 2 chars/pixel
    const px = Math.max(0, Math.floor((width - spriteW) / 2))
    for (const l of spriteLines) {
      lines.push(' '.repeat(px) + l)
    }

    lines.push('')

    // Message
    const msg = "O L L A M A   N O T   R U N N I N G   —   H O W   W I L L   I   R U N ?"
    const msgW = msg.length
    const mx = Math.max(0, Math.floor((width - msgW) / 2))
    lines.push(' '.repeat(mx) + `${ansi.fg(colors.unit)}${ansi.bold}${msg}${ansi.reset}`)

    return lines
  }

  const logoWidth = 55  // 7 chars × 7 glyphs + 6 gaps
  const cx = Math.max(0, Math.floor((width - logoWidth) / 2))

  // Spacer to push logo down a bit
  const topPad = Math.max(2, Math.floor((height - 14) / 2))
  for (let i = 0; i < topPad; i++) lines.push('')

  // Figlet logo (centered)
  const logoLines = renderFiglet('UNIT-01', 15).split('\n')
  for (const l of logoLines) {
    lines.push(' '.repeat(cx) + l)
  }

  // Tagline (centered under logo)
  const tagW = vw(renderTagline())
  const tagX = Math.max(0, Math.floor((width - tagW) / 2))
  lines.push(' '.repeat(tagX) + renderTagline())

  lines.push('')

  // Thin char bar separator (centered, 40 cols)
  const barW = 40
  const barX = Math.max(0, Math.floor((width - barW) / 2))
  lines.push(' '.repeat(barX) + `${ansi.fg(colors.border)}${'─'.repeat(barW)}${ansi.reset}`)

  lines.push('')

  // Status row: daemon dots + current model
  const idxDot = `${ansi.fg(state.indexerRunning ? colors.ok : colors.textMuted)}${state.indexerRunning ? '●' : '○'}${ansi.reset}`
  const sbxDot = `${ansi.fg(state.sandboxRunning ? colors.ok : colors.textMuted)}${state.sandboxRunning ? '●' : '○'}${ansi.reset}`
  const ollDot = `${ansi.fg(state.ollamaRunning ? colors.ok : colors.textMuted)}${state.ollamaRunning ? '●' : '○'}${ansi.reset}`

  const statusLeft = `${idxDot} ${ansi.fg(colors.textMuted)}idx${ansi.reset}   ${sbxDot} ${ansi.fg(colors.textMuted)}sbx${ansi.reset}   ${ollDot} ${ansi.fg(colors.textMuted)}oll${ansi.reset}`
  const statusRight = state.model
    ? `${ansi.fg(colors.mag)}${ansi.bold}${state.model}${ansi.reset}`
    : `${ansi.fg(colors.textMuted)}no model${ansi.reset}`
  const statusW = vw(statusLeft) + 4 + vw(statusRight)
  const statusX = Math.max(0, Math.floor((width - statusW) / 2))
  lines.push(' '.repeat(statusX) + statusLeft + '    ' + statusRight)

  lines.push('')

  // Hint text (centered)
  let hint: string
  if (!state.ollamaRunning) {
    hint = `${ansi.fg(colors.error)}Ollama not reachable${ansi.reset} ${ansi.fg(colors.textMuted)}— run ${ansi.reset}${ansi.fg(colors.unit)}ollama serve${ansi.reset}`
  } else if (state.loading) {
    hint = `${ansi.fg(colors.warn)}◐${ansi.reset} ${ansi.fg(colors.textMuted)}Discovering models...${ansi.reset}`
  } else if (state.models.length === 0) {
    hint = `${ansi.fg(colors.error)}No models found${ansi.reset} ${ansi.fg(colors.textMuted)}— ${ansi.reset}${ansi.fg(colors.unit)}ollama pull llama3.1:8b${ansi.reset}`
  } else if (!state.model) {
    hint = `${ansi.fg(colors.unit)}/model${ansi.reset} ${ansi.fg(colors.textMuted)}to choose a model · ${ansi.reset}${ansi.fg(colors.unit)}/help${ansi.reset} ${ansi.fg(colors.textMuted)}for commands${ansi.reset}`
  } else {
    hint = `${ansi.fg(colors.unit)}enter${ansi.reset} ${ansi.fg(colors.textMuted)}to start · ${ansi.reset}${ansi.fg(colors.unit)}/model${ansi.reset} ${ansi.fg(colors.textMuted)}to switch · ${ansi.reset}${ansi.fg(colors.unit)}/help${ansi.reset} ${ansi.fg(colors.textMuted)}for commands${ansi.reset}`
  }
  const hintW = vw(hint)
  const hintX = Math.max(0, Math.floor((width - hintW) / 2))
  lines.push(' '.repeat(hintX) + hint)

  return lines
}
