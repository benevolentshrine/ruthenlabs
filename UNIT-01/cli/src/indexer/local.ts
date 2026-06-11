import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'fs';
import { join, resolve, basename, dirname } from 'path';
import { chunkFile, languageFromExt, ChunkType, type Chunk } from './chunker.js';

export interface SearchResult {
  path: string;
  line?: number;
  content: string;
  score: number;
  language?: string;
  span?: [number, number];
}

interface ShadowEntry {
  path_hash: string;
  original_path: string;
}

// ── Deterministic Term-Hashing Embedder (Matching Rust HashEmbedder) ─────────
const EMBEDDING_DIM = 256;

function getFnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function embedHash(text: string): number[] {
  const vec = new Array(EMBEDDING_DIM).fill(0);
  const terms = text
    .split(/[^a-zA-Z0-9]/)
    .filter(t => t.length > 1);

  for (const term of terms) {
    const hash = getFnv1aHash(term.toLowerCase());
    const idx = hash % EMBEDDING_DIM;
    vec[idx] += 1.0;
  }

  for (let i = 0; i < terms.length - 1; i++) {
    const bigram = (terms[i] + ' ' + terms[i + 1]).toLowerCase();
    const hash = getFnv1aHash(bigram);
    const idx = hash % EMBEDDING_DIM;
    vec[idx] += 0.5;
  }

  const sumSq = vec.reduce((sum, val) => sum + val * val, 0);
  const magnitude = Math.sqrt(sumSq);
  if (magnitude > 0) {
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      vec[i] /= magnitude;
    }
  }
  return vec;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}



// ── Local Indexer Class ──────────────────────────────────────────────────────
export class LocalIndexer {
  private db: Database;
  private rootDir: string = process.cwd();

  constructor() {
    const home = process.env.HOME || '/tmp';
    const dataDir = process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support', 'com.ruthenlabs.indexer')
      : join(home, '.local', 'share', 'com.ruthenlabs.indexer');

    mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'db.sqlite');
    this.db = new Database(dbPath);

    this.initSchema();
  }

  private initSchema() {
    // 1. Files metadata table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS files (
        path       TEXT PRIMARY KEY,
        hash       TEXT NOT NULL,
        size       INTEGER NOT NULL,
        modified   INTEGER NOT NULL
      );
    `);

    // 2. Chunks table (with float array embedding as JSON/Text)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chunks (
        id          TEXT PRIMARY KEY,
        filepath    TEXT NOT NULL,
        relpath     TEXT NOT NULL,
        language    TEXT NOT NULL,
        start_line  INTEGER NOT NULL,
        end_line    INTEGER NOT NULL,
        content     TEXT NOT NULL,
        chunk_type  TEXT NOT NULL,
        name        TEXT,
        embedding   TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_filepath ON chunks(filepath);
    `);

    // 3. FTS5 Search virtual table
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
        chunk_id UNINDEXED,
        filepath,
        content,
        language,
        chunk_type,
        name
      );
    `);

    // 4. Triggers to keep FTS table in sync
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS t_chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO fts_chunks(chunk_id, filepath, content, language, chunk_type, name)
        VALUES (new.id, new.relpath, new.content, new.language, new.chunk_type, new.name);
      END;
      CREATE TRIGGER IF NOT EXISTS t_chunks_ad AFTER DELETE ON chunks BEGIN
        DELETE FROM fts_chunks WHERE chunk_id = old.id;
      END;
      CREATE TRIGGER IF NOT EXISTS t_chunks_au AFTER UPDATE ON chunks BEGIN
        DELETE FROM fts_chunks WHERE chunk_id = old.id;
        INSERT INTO fts_chunks(chunk_id, filepath, content, language, chunk_type, name)
        VALUES (new.id, new.relpath, new.content, new.language, new.chunk_type, new.name);
      END;
    `);



    // 6. Shadow Backups table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS shadow_backups (
        path_hash   TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        content     TEXT NOT NULL
      );
    `);
  }

  // Fast start check: compare disk with db metadata
  async indexDeps(root = '.'): Promise<{ indexed: number; nodes: number }> {
    this.rootDir = resolve(root);
    let indexedCount = 0;

    // Recursive directory walk
    const walk = (dir: string, fileList: string[] = []) => {
      const entries = readdirSync(dir);
      for (const name of entries) {
        if (name === '.git' || name === 'node_modules' || name === 'dist' || name === 'target') continue;
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full, fileList);
        } else if (stat.isFile()) {
          fileList.push(full);
        }
      }
      return fileList;
    };

    const diskFiles = walk(this.rootDir);

    // Get current DB metadata
    const dbRows = this.db.prepare('SELECT path, hash, modified FROM files').all() as any[];
    const dbMap = new Map<string, { hash: string; modified: number }>();
    for (const r of dbRows) {
      dbMap.set(r.path, { hash: r.hash, modified: r.modified });
    }

    const currentPaths = new Set<string>();

    for (const file of diskFiles) {
      currentPaths.add(file);
      const stat = statSync(file);
      const modified = Math.floor(stat.mtimeMs);
      const size = stat.size;

      const cached = dbMap.get(file);
      if (!cached || cached.modified !== modified) {
        // Index this file
        try {
          const content = readFileSync(file, 'utf-8');
          const hash = Bun.SHA256.hash(content, 'hex');

          // Delete old records
          this.db.prepare('DELETE FROM chunks WHERE filepath = ?').run(file);

          const rel = file.slice(this.rootDir.length + 1);
          const ext = file.split('.').pop() || '';
          const lang = languageFromExt(ext);

          const chunks = chunkFile(content, file, rel, lang);
          for (const chunk of chunks) {
            const embedding = embedHash(chunk.content);
            this.db.prepare(`
              INSERT OR REPLACE INTO chunks (id, filepath, relpath, language, start_line, end_line, content, chunk_type, name, embedding)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              chunk.chunk_id,
              chunk.filepath,
              chunk.relative_path,
              chunk.language,
              chunk.start_line,
              chunk.end_line,
              chunk.content,
              chunk.chunk_type,
              chunk.name,
              JSON.stringify(embedding)
            );
          }

          // Save file metadata
          this.db.prepare('INSERT OR REPLACE INTO files (path, hash, size, modified) VALUES (?, ?, ?, ?)').run(file, hash, size, modified);
          indexedCount++;
        } catch (e) {
          console.error(`Error indexing ${file}:`, e);
        }
      }
    }

    // Clean up deleted files
    for (const cachedPath of dbMap.keys()) {
      if (!currentPaths.has(cachedPath)) {
        this.db.prepare('DELETE FROM files WHERE path = ?').run(cachedPath);
        this.db.prepare('DELETE FROM chunks WHERE filepath = ?').run(cachedPath);
      }
    }

    const totalNodes = (this.db.prepare('SELECT COUNT(*) as count FROM files').get() as any).count;
    return { indexed: indexedCount, nodes: totalNodes };
  }

  status() {
    return { status: 'running' };
  }

  stop() {
    return { status: 'stopping' };
  }

  // FTS5 Full Text Search
  search(query: string, opts: { limit?: number; lang?: string; path?: string } = {}) {
    const limit = opts.limit ?? 20;
    const cleanQuery = query.replace(/[^a-zA-Z0-9 ]/g, ' ').trim();
    if (!cleanQuery) return { results: [], count: 0 };

    let sql = `
      SELECT chunk_id, filepath, content, language, filepath as relpath
      FROM fts_chunks
      WHERE content MATCH ?
    `;
    const params: any[] = [cleanQuery];

    if (opts.lang) {
      sql += ' AND language = ?';
      params.push(opts.lang);
    }
    if (opts.path) {
      sql += ' AND filepath LIKE ?';
      params.push(`%${opts.path}%`);
    }

    sql += ' LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];

    // Extract line numbers from chunk_id (format: relpath:startLine:endLine)
    const results: SearchResult[] = rows.map((r: any) => {
      const parts = r.chunk_id.split(':');
      const startLine = parts.length >= 3 ? parseInt(parts[parts.length - 2], 10) + 1 : 1;
      return {
        path: r.filepath,
        line: startLine,
        content: r.content,
        score: 1.0,
        language: r.language
      };
    });

    return { results, count: results.length };
  }

  // Linear scan vector similarity lookup
  semanticSearch(query: string, limit = 10) {
    const qEmbed = embedHash(query);
    const rows = this.db.prepare('SELECT id, filepath, relpath, content, language, embedding FROM chunks WHERE embedding IS NOT NULL').all() as any[];

    const results: (SearchResult & { rawScore: number })[] = [];

    for (const r of rows) {
      try {
        const embedding = JSON.parse(r.embedding) as number[];
        const score = cosineSimilarity(qEmbed, embedding);
        if (score > 0) {
          const parts = r.id.split(':');
          const startLine = parts.length >= 3 ? parseInt(parts[parts.length - 2], 10) + 1 : 1;
          results.push({
            path: r.filepath,
            line: startLine,
            content: r.content,
            score,
            rawScore: score,
            language: r.language
          });
        }
      } catch {}
    }

    results.sort((a, b) => b.rawScore - a.rawScore);
    const sliced = results.slice(0, limit);
    return { results: sliced, count: sliced.length };
  }

  glob(pattern: string, base = '.') {
    // Basic file list filter matching glob pattern
    const absoluteBase = resolve(base);
    const regexStr = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    const regex = new RegExp(`^${regexStr}$`);

    const rows = this.db.prepare('SELECT path FROM files').all() as any[];
    const files = rows
      .map(r => r.path)
      .filter(p => p.startsWith(absoluteBase))
      .map(p => p.slice(this.rootDir.length + 1))
      .filter(rel => regex.test(rel));

    return { files };
  }

  find(name: string, root = '.') {
    const absoluteRoot = resolve(root);
    const rows = this.db.prepare('SELECT path FROM files WHERE path LIKE ?').all(`%${name}%`) as any[];
    const files = rows
      .map(r => r.path)
      .filter(p => p.startsWith(absoluteRoot))
      .map(p => p.slice(this.rootDir.length + 1));
    return { files };
  }

  fileInfo(path: string) {
    const absolute = resolve(path);
    const stat = statSync(absolute);
    return {
      size: stat.size,
      is_dir: stat.isDirectory(),
      modified: Math.floor(stat.mtimeMs / 1000)
    };
  }

  read(path: string) {
    const absolute = resolve(path);
    const content = readFileSync(absolute, 'utf-8');
    return { content };
  }

  async readLines(path: string, start: number, end: number) {
    const absolute = resolve(path);
    const content = readFileSync(absolute, 'utf-8');
    const lines = content.split('\n');
    const from = Math.max(0, start - 1);
    const to = Math.min(lines.length, end);
    return {
      content: lines.slice(from, to).join('\n'),
      total: lines.length
    };
  }

  write(path: string, content: string) {
    const absolute = resolve(path);
    const parentDir = dirname(absolute);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    if (existsSync(absolute)) {
      this.createShadowBackup(path, absolute);
    }
    writeFileSync(absolute, content);
    return { status: 'written' };
  }

  patch(path: string, target: string, replacement: string) {
    const absolute = resolve(path);
    const content = readFileSync(absolute, 'utf-8');
    if (!content.includes(target)) {
      throw new Error('Target text not found in file');
    }
    this.createShadowBackup(path, absolute);
    const updated = content.replace(target, replacement);
    writeFileSync(absolute, updated);
    return { status: 'patched' };
  }



  // Shadow Backup actions
  private createShadowBackup(pathStr: string, actualPath: string) {
    const content = readFileSync(actualPath, 'utf-8');
    const hash = Bun.SHA256.hash(pathStr, 'hex').slice(0, 16);
    this.db.prepare('INSERT OR REPLACE INTO shadow_backups (path_hash, original_path, content) VALUES (?, ?, ?)')
      .run(hash, pathStr, content);
  }

  shadowList() {
    const rows = this.db.prepare('SELECT path_hash, original_path FROM shadow_backups').all() as any[];
    const entries = rows.map(r => ({
      path_hash: r.path_hash,
      original_path: r.original_path
    }));
    return { entries, count: entries.length };
  }

  getRepositoryMap(maxChars = 6000): string {
    try {
      const rows = this.db.prepare(`
        SELECT filepath, chunk_type, name
        FROM chunks
        WHERE chunk_type IN ('Class', 'Function')
        ORDER BY filepath, start_line
      `).all() as any[];

      const filesMap = new Map<string, string[]>();
      for (const r of rows) {
        if (!filesMap.has(r.filepath)) {
          filesMap.set(r.filepath, []);
        }
        const prefix = r.chunk_type === 'Class' ? '  class ' : '  fn ';
        if (r.name) {
          filesMap.get(r.filepath)!.push(`${prefix}${r.name}`);
        }
      }

      let mapText = '## Repository Map (Signatures)\n';
      for (const [file, symbols] of filesMap.entries()) {
        if (symbols.length === 0) continue;
        const fileBlock = `${file}:\n` + symbols.join('\n') + '\n\n';
        if (mapText.length + fileBlock.length > maxChars) {
          mapText += `... [Repository Map truncated to conserve context window] ...\n`;
          break;
        }
        mapText += fileBlock;
      }
      return mapText;
    } catch {
      return '';
    }
  }

  rollback() {
    const rows = this.db.prepare('SELECT original_path, content FROM shadow_backups').all() as any[];
    for (const r of rows) {
      try {
        const absolute = resolve(r.original_path);
        writeFileSync(absolute, r.content);
      } catch {}
    }
    this.db.run('DELETE FROM shadow_backups');
    return { status: 'rolled back' };
  }
}
