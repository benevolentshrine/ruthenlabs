// ── Daemon lifecycle: start/stop the rust daemons ─────────────────────

import { existsSync, readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { IndexerClient, INDEXER_SOCKET } from './indexer.js'
import { SandboxClient, SANDBOX_SOCKET } from './sandbox.js'

// Find the project root by walking up from this file looking for Cargo.toml
function findProjectRoot(): string {
  if (process.env.UNIT01_ROOT) return process.env.UNIT01_ROOT
  let dir = dirname(new URL(import.meta.url).pathname)
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'Cargo.toml'))) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

const PROJECT_ROOT = findProjectRoot()
const TARGET_DIR = join(PROJECT_ROOT, 'target', 'release')

interface ProcessHandle {
  pid: number
  // Bun.spawn returns Subprocess; we use Bun's process abstraction
}

let indexerProc: any = null
let sandboxProc: any = null

export function isIndexerRunning(): boolean {
  return existsSync(INDEXER_SOCKET)
}

export function isSandboxRunning(): boolean {
  return existsSync(SANDBOX_SOCKET)
}

async function waitForSocket(path: string, timeoutMs = 15000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      // Also wait until we can actually connect (file may exist but daemon not ready)
      try {
        const sock = await Bun.connect({ unix: path, socket: { open: () => {}, data: () => {}, close: () => {}, error: () => {} } })
        sock.end()
        return true
      } catch {
        // not yet ready
      }
    }
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

export async function startIndexer(): Promise<IndexerClient> {
  const client = new IndexerClient()
  if (isIndexerRunning()) {
    try {
      await client.status()
      return client
    } catch {
      // stale socket, fall through
    }
  }
  const binary = `${TARGET_DIR}/indexer`
  if (!existsSync(binary)) {
    throw new Error(`Indexer binary not found at ${binary}. Run: cargo build --release`)
  }
  // Use double-fork via nohup + subshell: the forking indexer binary needs to be
  // detached from our process group, otherwise it dies when we exit.
  const setsidCmd = `( nohup ${binary} daemon start </dev/null >/dev/null 2>&1 & )`
  Bun.spawnSync(['sh', '-c', setsidCmd], { stdio: ['ignore', 'ignore', 'ignore'] })
  const ok = await waitForSocket(INDEXER_SOCKET)
  if (!ok) throw new Error('Indexer failed to start (socket not created)')
  await client.status()
  return client
}

export async function startSandbox(): Promise<SandboxClient> {
  const client = new SandboxClient()
  if (isSandboxRunning()) {
    try {
      // verify with workspace
      const wd = process.cwd()
      await client.setWorkspace(wd)
      try {
        await updateSandboxPolicyFromLockfiles(client, wd)
      } catch {}
      return client
    } catch {
      // fall through
    }
  }
  // On darwin, the actual `sandbox` binary works (the sandbox-darwin is a separate
  // cross-compile shim that requires linux/arm64 static build). The real darwin
  // sandbox lives in target/release/sandbox.
  const candidates = [
    `${TARGET_DIR}/sandbox`,
    `${TARGET_DIR}/sandbox-darwin`,
  ]
  const binary = candidates.find(p => existsSync(p))
  if (!binary) {
    throw new Error(`Sandbox binary not found. Run: cargo build --release`)
  }
  // Same double-fork trick for the sandbox
  const setsidCmd = `( nohup ${binary} </dev/null >/dev/null 2>&1 & )`
  Bun.spawnSync(['sh', '-c', setsidCmd], { stdio: ['ignore', 'ignore', 'ignore'] })
  const ok = await waitForSocket(SANDBOX_SOCKET)
  if (!ok) throw new Error('Sandbox failed to start (socket not created)')
  // set workspace to cwd
  const cwd = process.cwd()
  await client.setWorkspace(cwd)
  try {
    await updateSandboxPolicyFromLockfiles(client, cwd)
  } catch {}
  return client
}

export async function updateSandboxPolicyFromLockfiles(client: SandboxClient, workingDir: string): Promise<string[]> {
  const domains = new Set<string>()

  // 1. package-lock.json
  try {
    const pkgLockPath = join(workingDir, 'package-lock.json')
    if (existsSync(pkgLockPath)) {
      const data = JSON.parse(readFileSync(pkgLockPath, 'utf-8'))
      const walk = (obj: any) => {
        if (!obj || typeof obj !== 'object') return
        if (typeof obj.resolved === 'string') {
          try {
            const url = new URL(obj.resolved)
            domains.add(url.hostname)
          } catch {}
        }
        for (const k of Object.keys(obj)) {
          walk(obj[k])
        }
      }
      walk(data)
    }
  } catch {}

  // 2. yarn.lock
  try {
    const yarnLockPath = join(workingDir, 'yarn.lock')
    if (existsSync(yarnLockPath)) {
      const content = readFileSync(yarnLockPath, 'utf-8')
      const regex = /resolved\s+["']?(https?:\/\/[^"'\s\n]+)/g
      let match
      while ((match = regex.exec(content)) !== null) {
        try {
          const url = new URL(match[1])
          domains.add(url.hostname)
        } catch {}
      }
    }
  } catch {}

  // 3. pnpm-lock.yaml
  try {
    const pnpmLockPath = join(workingDir, 'pnpm-lock.yaml')
    if (existsSync(pnpmLockPath)) {
      const content = readFileSync(pnpmLockPath, 'utf-8')
      const regex = /resolution:\s*\{\s*tarball:\s*["']?(https?:\/\/[^"'\s\n,}]+)/g
      let match
      while ((match = regex.exec(content)) !== null) {
        try {
          const url = new URL(match[1])
          domains.add(url.hostname)
        } catch {}
      }
    }
  } catch {}

  // 4. Cargo.lock
  try {
    const cargoLockPath = join(workingDir, 'Cargo.lock')
    if (existsSync(cargoLockPath)) {
      const content = readFileSync(cargoLockPath, 'utf-8')
      const regex = /source\s*=\s*"([^"]+)"/g
      let match
      while ((match = regex.exec(content)) !== null) {
        let src = match[1]
        if (src.startsWith('registry+')) {
          src = src.slice(9)
        }
        if (src.startsWith('git+')) {
          src = src.slice(4)
        }
        try {
          const url = new URL(src)
          domains.add(url.hostname)
        } catch {}
      }
    }
  } catch {}

  const extraDomains = Array.from(domains)
  const ecosystems = ['node', 'python', 'rust', 'go', 'github', 'brew', 'infra']

  await client.setPolicy({
    enabled: true,
    deny_network: true,
    ecosystems,
    allowed_domains: extraDomains,
  })

  return extraDomains
}

export async function ensureDaemons(): Promise<{ indexer: IndexerClient; sandbox: SandboxClient }> {
  const [indexer, sandbox] = await Promise.all([startIndexer(), startSandbox()])
  return { indexer, sandbox }
}

export async function stopDaemons(): Promise<void> {
  try {
    const c = new IndexerClient()
    await c.stop()
  } catch {}
  try {
    // sandbox doesn't have a stop method; kill via pid
    if (sandboxProc) sandboxProc.kill()
  } catch {}
}

export { IndexerClient, SandboxClient }
