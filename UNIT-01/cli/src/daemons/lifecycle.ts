// ── Daemon lifecycle: start/stop the rust daemons ─────────────────────

import { existsSync, readFileSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { LocalIndexer as IndexerClient } from '../indexer/local.js'
import { LocalSandbox as SandboxClient } from '../sandbox/runner.js'

export async function startIndexer(): Promise<IndexerClient> {
  const client = new IndexerClient();
  await client.indexDeps(process.cwd());
  return client;
}

export async function startSandbox(): Promise<SandboxClient> {
  const client = new SandboxClient();
  const cwd = process.cwd();
  await client.setWorkspace(cwd);
  try {
    await updateSandboxPolicyFromLockfiles(client, cwd);
  } catch {}
  return client;
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
}

export { IndexerClient, SandboxClient }
