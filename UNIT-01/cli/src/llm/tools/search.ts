import type { ToolRunner, ToolContext } from './types.js'

export class SearchCodeRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    const r = await ctx.indexer.search(args.query as string, { limit: 10 })
    if (r.results.length === 0) return 'No matches found.'
    return r.results.slice(0, 10).map(res =>
      `${res.path}:${res.line ?? '?'}\n  ${res.content.trim().slice(0, 200)}`
    ).join('\n\n')
  }
}

export class ListDirRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    const path = (args.path as string) || '.'
    try {
      const { readdirSync, statSync } = await import('fs')
      const { join } = await import('path')
      const files = readdirSync(path)
      if (files.length === 0) return 'Directory is empty.'
      const sliced = files.slice(0, 100)
      const lines = sliced.map(f => {
        try {
          const stat = statSync(join(path, f))
          return `${stat.isDirectory() ? '[DIR]' : '[FILE]'} ${f}`
        } catch {
          return `[FILE] ${f}`
        }
      })
      if (files.length > 100) {
        lines.push(`\n[... Truncated: ${files.length - 100} more entries. Directory listing capped at 100 entries ...]`)
      }
      return lines.join('\n')
    } catch (e: any) {
      return `Error listing directory: ${e?.message ?? e}`
    }
  }
}
