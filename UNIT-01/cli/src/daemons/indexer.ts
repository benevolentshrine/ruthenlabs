// ── Indexer daemon client ─────────────────────────────────────────────

import { rpcOnce, DaemonError } from './socket.js'

export const INDEXER_SOCKET = '/tmp/ruthen/indexer.sock'

export interface SearchResult {
  path: string
  content: string
  score: number
  language?: string
  line?: number
  span?: [number, number]
}

export interface GlobResult { files: string[] }
export interface FindResult { files: string[] }
export interface FileInfo {
  size: number
  is_dir: boolean
  modified: number
}
export interface ReadResult { content: string }
export interface WriteResult { status: string }
export interface PatchResult { status: string }
export interface ShadowEntry { path_hash: string; original_path: string }
export interface ShadowListResult { entries: ShadowEntry[]; count: number }
export interface DependentsResult { dependents: string[] }
export interface DependenciesResult { dependencies: string[] }
export interface IndexDepsResult { indexed: number; nodes: number }
export interface ImpactResult { impact: string }

export class IndexerClient {
  socketPath: string
  constructor(socketPath = INDEXER_SOCKET) {
    this.socketPath = socketPath
  }

  status() {
    return rpcOnce<{ status: string }>(this.socketPath, 'status', {})
  }
  stop() {
    return rpcOnce<{ status: string }>(this.socketPath, 'stop', {})
  }
  search(query: string, opts: { limit?: number; lang?: string; path?: string } = {}) {
    return rpcOnce<{ results: SearchResult[]; count: number }>(this.socketPath, 'search', {
      query,
      limit: opts.limit ?? 20,
      ...(opts.lang ? { lang: opts.lang } : {}),
      ...(opts.path ? { path: opts.path } : {}),
    })
  }
  semanticSearch(query: string, limit = 10) {
    return rpcOnce<{ results: SearchResult[]; count: number }>(this.socketPath, 'semantic_search', { query, limit })
  }
  glob(pattern: string, base = '.') {
    return rpcOnce<GlobResult>(this.socketPath, 'glob', { pattern, base })
  }
  find(name: string, root = '.') {
    return rpcOnce<FindResult>(this.socketPath, 'find', { name, root })
  }
  fileInfo(path: string) {
    return rpcOnce<FileInfo>(this.socketPath, 'file_info', { path })
  }
  read(path: string) {
    return rpcOnce<ReadResult>(this.socketPath, 'read', { path })
  }
  write(path: string, content: string) {
    return rpcOnce<WriteResult>(this.socketPath, 'write', { path, content })
  }
  patch(path: string, target: string, replacement: string) {
    return rpcOnce<PatchResult>(this.socketPath, 'patch', { path, target, replacement })
  }
  dependents(path: string) {
    return rpcOnce<DependentsResult>(this.socketPath, 'dependents', { path })
  }
  dependencies(path: string) {
    return rpcOnce<DependenciesResult>(this.socketPath, 'dependencies', { path })
  }
  transitiveDependents(path: string) {
    return rpcOnce<DependentsResult>(this.socketPath, 'transitive_dependents', { path })
  }
  findExport(symbol: string) {
    return rpcOnce<{ files: string[] }>(this.socketPath, 'find_export', { symbol })
  }
  impact(path: string) {
    return rpcOnce<ImpactResult>(this.socketPath, 'impact', { path })
  }
  indexDeps(path = '.') {
    return rpcOnce<IndexDepsResult>(this.socketPath, 'index_deps', { path })
  }
  shadowList() {
    return rpcOnce<ShadowListResult>(this.socketPath, 'shadow_list', {})
  }
  rollback() {
    return rpcOnce<{ status: string }>(this.socketPath, 'rollback', {})
  }

  // Helper: read with line window
  async readLines(path: string, start: number, end: number): Promise<{ content: string; total: number }> {
    const r = await this.read(path)
    const lines = r.content.split('\n')
    const from = Math.max(0, start - 1)
    const to = Math.min(lines.length, end)
    return { content: lines.slice(from, to).join('\n'), total: lines.length }
  }

  isAlive(): boolean {
    try {
      // Fast reachability check
      return Bun.file(this.socketPath).size > 0
    } catch {
      return false
    }
  }
}
