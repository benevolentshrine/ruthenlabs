import type { ToolRunner, ToolContext } from './types.js'

export class GitStatusRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    try {
      const branchProc = Bun.spawn(['git', 'branch', '--show-current'], { stdout: 'pipe' })
      const branch = (await new Response(branchProc.stdout).text()).trim()
      
      const statusProc = Bun.spawn(['git', 'status', '--porcelain'], { stdout: 'pipe' })
      const statusText = (await new Response(statusProc.stdout).text()).trim()
      
      const lines = statusText ? statusText.split('\n') : []
      const modified: string[] = []
      const untracked: string[] = []
      const deleted: string[] = []
      const added: string[] = []
      
      for (const line of lines) {
        const code = line.slice(0, 2)
        const file = line.slice(3)
        if (code.includes('M')) {
          modified.push(file)
        } else if (code.includes('?')) {
          untracked.push(file)
        } else if (code.includes('D')) {
          deleted.push(file)
        } else if (code.includes('A')) {
          added.push(file)
        }
      }
      
      return JSON.stringify({
        branch,
        modified,
        untracked,
        deleted,
        added
      }, null, 2)
    } catch (e: any) {
      return `Error running git status: ${e?.message ?? e}`
    }
  }
}
