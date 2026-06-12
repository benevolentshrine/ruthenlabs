import type { ToolRunner, ToolContext } from './types.js'

export class RunCommandRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    const cmd = (args.command as string).trim()
    
    // Blacklist check
    if (cmd.match(/\brm\s+-rf\s+(\/|\*|~\/|~|\$HOME|(?:\.\.\/)+)$/) || cmd.match(/curl\s+.*\s*\|\s*(sh|bash)/) || cmd.match(/wget\s+.*\s*\|\s*(sh|bash)/)) {
      return `Error: Dangerous command blacklisted by sandbox policy.`
    }
    
    try {
      const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Command timed out after 30 seconds')), 30000))
      const isPkgCmd = /^(go|cargo|npm|bun|pip|yarn|pnpm)\b/.test(cmd)
      let accumulated = ''
      const executionPromise = ctx.sandbox.execute(cmd, {
        allow_network: isPkgCmd,
        onOutput: (chunk) => {
          accumulated += chunk
          if (ctx.onProgress) {
            let out = accumulated
            if (out.length > 2000) {
              out = out.slice(0, 2000) + '\n\n[... Truncated: command output exceeded 2000 characters ...]'
            }
            ctx.onProgress(out)
          }
        }
      })
      
      const r = await Promise.race([executionPromise, timeoutPromise])
      
      // Cap output to 2000 chars
      let out = r.verdict || ''
      if (out.length > 2000) {
        out = out.slice(0, 2000) + '\n\n[... Truncated: command output exceeded 2000 characters ...]'
      }
      return out
    } catch (e: any) {
      let msg = e?.message ?? String(e)
      if (msg.includes('Filesystem write blocked') || msg.includes('Landlock blocked')) {
        const cwd = process.cwd()
        msg += `\n\n[Actionable Advice] Keep all file operations inside the active workspace directory: "${cwd}". Do not write or read outside this tree. If writing scratch or temporary files, place them in "./tmp/" inside the workspace.`
      } else if (msg.includes('Seccomp blocked') || msg.includes('syscall')) {
        msg += `\n\n[Actionable Advice] This command used a system call restricted by the kernel sandbox. Try using standard shell commands, check your syntax, or ask the user to elevate permissions if this is necessary.`
      }
      return `Error: ${msg}`
    }
  }
}

export class DiagnosticsRunner implements ToolRunner {
  async execute(args: any, ctx: ToolContext): Promise<string> {
    try {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const cwd = process.cwd()
      
      if (existsSync(join(cwd, 'Cargo.toml'))) {
        const proc = Bun.spawn(['cargo', 'check'], { stderr: 'pipe', stdout: 'pipe' })
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        return `cargo check output:\nSTDOUT:\n${stdout.slice(0, 1000)}\nSTDERR:\n${stderr.slice(0, 1000)}`
      }
      
      if (existsSync(join(cwd, 'package.json'))) {
        if (existsSync(join(cwd, 'tsconfig.json'))) {
          const proc = Bun.spawn(['npx', 'tsc', '--noEmit'], { stderr: 'pipe', stdout: 'pipe' })
          const stdout = await new Response(proc.stdout).text()
          const stderr = await new Response(proc.stderr).text()
          if (!stdout && !stderr) return 'No TS diagnostics errors found.'
          return `tsconfig.json found, running tsc --noEmit:\nSTDOUT:\n${stdout.slice(0, 1000)}\nSTDERR:\n${stderr.slice(0, 1000)}`
        }
        const proc = Bun.spawn(['bun', 'test'], { stderr: 'pipe', stdout: 'pipe' })
        const stdout = await new Response(proc.stdout).text()
        const stderr = await new Response(proc.stderr).text()
        return `bun test output:\nSTDOUT:\n${stdout.slice(0, 1000)}\nSTDERR:\n${stderr.slice(0, 1000)}`
      }
      
      return 'No standard project configuration (Cargo.toml, package.json) found to run diagnostics.'
    } catch (e: any) {
      return `Error running diagnostics: ${e?.message ?? e}`
    }
  }
}
