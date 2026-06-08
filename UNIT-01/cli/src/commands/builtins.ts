// ── Slash command implementations ────────────────────────────────────

import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AppContext } from '../app.js'
import { registerCommands } from './registry.js'
import { listSessions } from '../config/store.js'
import { MODES } from '../modes/mode.js'
import type { PermissionMode } from '../types.js'

export function registerBuiltinCommands() {

  registerCommands([
    {
      name: '/help',
      description: 'show help',
      run: (ctx) => { ctx.showHelp() },
    },
    {
      name: '/init',
      description: 'create UNIT.md with project context',
      run: (ctx) => {
        const cwd = ctx.state.workingDir
        const path = join(cwd, 'UNIT.md')
        if (existsSync(path)) {
          ctx.notify('warn', `UNIT.md already exists at ${path}`)
          return
        }
        const content = `# ${cwd.split('/').pop()}

## What this is
A short description of the project.

## Key files
- \`path/to/main.ts\` — entry point
- \`path/to/lib/\` — core library

## Conventions
- Style, testing approach, naming.

## Tools the model should use
- Use \`search_code\` before editing unknown files.
- Use \`run_command\` for tests, builds, git.
- Prefer \`patch_file\` over \`write_file\` for edits.
`
        writeFileSync(path, content, 'utf-8')
        ctx.notify('success', `Created ${path}`)
      },
    },
    {
      name: '/model',
      description: 'choose a model',
      run: async (ctx, args) => {
        if (args.trim()) {
          ctx.setModel(args.trim())
        } else {
          ctx.requestModelPicker()
        }
      },
    },
    {
      name: '/mode',
      description: 'set permission mode (plan|ask|auto-edit|auto|yolo)',
      run: (ctx, args) => {
        const m = args.trim().toLowerCase() as PermissionMode
        if (!MODES.find(x => x.id === m)) {
          ctx.notify('error', `Unknown mode: ${m}. Valid: ${MODES.map(x => x.id).join(', ')}`)
          return
        }
        ctx.setMode(m)
        ctx.notify('success', `Mode → ${m}`)
      },
    },
    {
      name: '/doctor',
      description: 'show status of indexer, sandbox, and model',
      run: async (ctx) => {
        const lines: string[] = []
        lines.push(`${ctx.ansi.fg(ctx.colors.ok)}●${ctx.ansi.reset} indexer: ${ctx.state.indexerState}`)
        lines.push(`${ctx.ansi.fg(ctx.colors.ok)}●${ctx.ansi.reset} sandbox: ${ctx.state.sandboxState}`)
        lines.push(`model:    ${ctx.state.model ?? '(none)'}`)
        lines.push(`mode:     ${ctx.state.mode}`)
        lines.push(`tokens:   ${ctx.state.tokensIn} in / ${ctx.state.tokensOut} out / ${ctx.state.contextWindow} ctx`)
        lines.push(`messages: ${ctx.state.messages.length}`)
        lines.push(`cwd:      ${ctx.state.workingDir}`)
        ctx.showDoctor(lines)
      },
    },
    {
      name: '/index',
      description: 'rebuild the index for the working dir',
      run: async (ctx) => {
        try {
          ctx.notify('info', 'Indexing...')
          const r = await ctx.indexer.indexDeps(ctx.state.workingDir)
          ctx.notify('success', `Indexed ${r.indexed} files (${r.nodes} dep nodes)`)
        } catch (e: any) {
          ctx.notify('error', `Index failed: ${e?.message ?? e}`)
        }
      },
    },
    {
      name: '/shadow',
      description: 'list shadow backups',
      run: async (ctx) => {
        try {
          const r = await ctx.indexer.shadowList()
          if (r.entries.length === 0) {
            ctx.notify('dim', 'No shadow backups.')
            return
          }
          for (const e of r.entries) {
            ctx.notify('dim', `  ${e.original_path}`)
          }
          ctx.notify('info', `${r.count} shadow backup(s)`)
        } catch (e: any) {
          ctx.notify('error', `Shadow list failed: ${e?.message ?? e}`)
        }
      },
    },
    {
      name: '/undo',
      description: 'rollback last writes (restore from shadow backups)',
      run: async (ctx) => {
        try {
          const r = await ctx.indexer.rollback()
          ctx.notify('success', `Rollback: ${r.status}`)
        } catch (e: any) {
          ctx.notify('error', `Rollback failed: ${e?.message ?? e}`)
        }
      },
    },
    {
      name: '/deps',
      description: 'find dependents and dependencies of a file',
      run: async (ctx, args) => {
        let file = args.trim()
        if (!file) {
          const asked = await ctx.promptForFile()
          if (!asked) return
          file = asked
        }
        try {
          const [deps, dependents] = await Promise.all([
            ctx.indexer.dependencies(file),
            ctx.indexer.dependents(file),
          ])
          ctx.notify('info', `${file}`)
          ctx.notify('dim', `  dependencies (${deps.dependencies.length}):`)
          for (const d of deps.dependencies) ctx.notify('dim', `    → ${d}`)
          ctx.notify('dim', `  dependents (${dependents.dependents.length}):`)
          for (const d of dependents.dependents) ctx.notify('dim', `    ← ${d}`)
        } catch (e: any) {
          ctx.notify('error', `Deps failed: ${e?.message ?? e}`)
        }
      },
    },
    {
      name: '/impact',
      description: 'transitive impact analysis of a file',
      run: async (ctx, args) => {
        let file = args.trim()
        if (!file) {
          const asked = await ctx.promptForFile()
          if (!asked) return
          file = asked
        }
        try {
          const r = await ctx.indexer.impact(file)
          ctx.notify('info', r.impact || 'No impact.')
        } catch (e: any) {
          ctx.notify('error', `Impact failed: ${e?.message ?? e}`)
        }
      },
    },
    {
      name: '/compress',
      description: 'summarize oldest messages to free context',
      run: async (ctx) => {
        const n = await ctx.compress()
        ctx.notify('success', `Compressed ${n} messages.`)
      },
    },
    {
      name: '/clear',
      description: 'clear the screen and messages',
      run: (ctx) => { ctx.clearMessages() },
    },
    {
      name: '/save',
      description: 'save current session',
      run: (ctx, args) => {
        const name = args.trim() || `session-${Date.now().toString(36)}`
        ctx.saveSession(name)
        ctx.notify('success', `Saved session: ${name}`)
      },
    },
    {
      name: '/resume',
      description: 'resume a saved session',
      run: (ctx, args) => {
        const name = args.trim()
        if (!name) {
          ctx.notify('error', 'Usage: /resume <name>')
          return
        }
        if (ctx.resumeSession(name)) {
          ctx.notify('success', `Resumed: ${name}`)
        } else {
          ctx.notify('error', `Session not found: ${name}`)
        }
      },
    },

    {
      name: '/theme',
      description: 'switch theme',
      run: (ctx, args) => { ctx.notify('dim', 'Themes coming soon.') },
    },
    {
      name: '/quit',
      description: 'exit',
      run: (ctx) => { ctx.quit() },
    },
    {
      name: '/exit',
      description: 'exit the application',
      run: (ctx) => { ctx.quit() },
    },
    {
      name: '/new',
      description: 'start a new session',
      run: (ctx) => {
        ctx.clearMessages()
        ctx.notify('success', 'New session started')
      },
    },
    {
      name: '/session',
      description: 'manage sessions (resume or list)',
      run: (ctx) => {
        ctx.notify('info', 'Type /resume to select a session.')
      },
    },
  ])
}
