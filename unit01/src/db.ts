import { DatabaseSync } from 'node:sqlite';
import * as fs from 'fs';
import * as path from 'path';

export interface FileRecord {
  path: string;
  hash: string;
  size: number;
  modified: number;
}

export interface ChunkRecord {
  id: string; // "relpath:startline:endline"
  filepath: string;
  relpath: string;
  language: string;
  start_line: number;
  end_line: number;
  content: string;
  chunk_type: 'function' | 'class' | 'module' | 'file';
  name: string;
}

export interface ShadowBackupRecord {
  path_hash: string;
  original_path: string;
  content: string;
}

export class IndexerDB {
  private db: DatabaseSync;

  constructor(workspaceRoot: string) {
    const dbDir = path.join(workspaceRoot, '.ruthen');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, 'indexer.db');
    this.db = new DatabaseSync(dbPath);
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        modified INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        filepath TEXT NOT NULL,
        relpath TEXT NOT NULL,
        language TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        content TEXT NOT NULL,
        chunk_type TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
        chunk_id UNINDEXED,
        filepath,
        content,
        language,
        name
      );

      CREATE TABLE IF NOT EXISTS shadow_backups (
        path_hash TEXT PRIMARY KEY,
        original_path TEXT NOT NULL,
        content TEXT NOT NULL
      );
    `);

    // Triggers for syncing virtual FTS table
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
        INSERT INTO fts_chunks(chunk_id, filepath, content, language, name)
        VALUES (new.id, new.filepath, new.content, new.language, new.name);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
        DELETE FROM fts_chunks WHERE chunk_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
        DELETE FROM fts_chunks WHERE chunk_id = old.id;
        INSERT INTO fts_chunks(chunk_id, filepath, content, language, name)
        VALUES (new.id, new.filepath, new.content, new.language, new.name);
      END;
    `);
  }

  // Transaction Helper
  private runInTransaction(callback: () => void) {
    this.db.exec('BEGIN TRANSACTION');
    try {
      callback();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // --- Files Operations ---
  public getFile(filePath: string): FileRecord | null {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
    return row ? (row as unknown as FileRecord) : null;
  }

  public upsertFile(file: FileRecord) {
    this.db.prepare(`
      INSERT INTO files (path, hash, size, modified)
      VALUES ($path, $hash, $size, $modified)
      ON CONFLICT(path) DO UPDATE SET
        hash = excluded.hash,
        size = excluded.size,
        modified = excluded.modified
    `).run({
      path: file.path,
      hash: file.hash,
      size: file.size,
      modified: file.modified
    });
  }

  public removeFile(filePath: string) {
    this.runInTransaction(() => {
      this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
      this.db.prepare('DELETE FROM chunks WHERE filepath = ?').run(filePath);
    });
  }

  public getAllFiles(): FileRecord[] {
    return this.db.prepare('SELECT * FROM files').all() as unknown as FileRecord[];
  }

  // --- Chunks Operations ---
  public insertChunks(chunks: ChunkRecord[]) {
    if (chunks.length === 0) return;
    const insert = this.db.prepare(`
      INSERT INTO chunks (id, filepath, relpath, language, start_line, end_line, content, chunk_type, name)
      VALUES ($id, $filepath, $relpath, $language, $start_line, $end_line, $content, $chunk_type, $name)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        start_line = excluded.start_line,
        end_line = excluded.end_line,
        chunk_type = excluded.chunk_type,
        name = excluded.name
    `);

    this.runInTransaction(() => {
      for (const record of chunks) {
        insert.run({
          id: record.id,
          filepath: record.filepath,
          relpath: record.relpath,
          language: record.language,
          start_line: record.start_line,
          end_line: record.end_line,
          content: record.content,
          chunk_type: record.chunk_type,
          name: record.name
        });
      }
    });
  }

  public removeChunksForFile(filePath: string) {
    this.db.prepare('DELETE FROM chunks WHERE filepath = ?').run(filePath);
  }

  public getChunksForFile(filePath: string): ChunkRecord[] {
    return this.db.prepare('SELECT * FROM chunks WHERE filepath = ?').all(filePath) as unknown as ChunkRecord[];
  }

  public getAllChunks(): ChunkRecord[] {
    return this.db.prepare('SELECT * FROM chunks').all() as unknown as ChunkRecord[];
  }

  public searchChunks(query: string): (ChunkRecord & { rank: number })[] {
    const safeQuery = `"${query.replace(/"/g, '""')}"`;
    return this.db.prepare(`
      SELECT c.*, f.rank
      FROM fts_chunks f
      JOIN chunks c ON c.id = f.chunk_id
      WHERE fts_chunks MATCH ?
      ORDER BY rank
    `).all(safeQuery) as unknown as (ChunkRecord & { rank: number })[];
  }

  // --- Shadow Backup Operations ---
  public getBackup(pathHash: string): ShadowBackupRecord | null {
    const row = this.db.prepare('SELECT * FROM shadow_backups WHERE path_hash = ?').get(pathHash);
    return row ? (row as unknown as ShadowBackupRecord) : null;
  }

  public upsertBackup(backup: ShadowBackupRecord) {
    this.db.prepare(`
      INSERT INTO shadow_backups (path_hash, original_path, content)
      VALUES ($path_hash, $original_path, $content)
      ON CONFLICT(path_hash) DO UPDATE SET
        content = excluded.content
    `).run({
      path_hash: backup.path_hash,
      original_path: backup.original_path,
      content: backup.content
    });
  }

  public removeBackup(pathHash: string) {
    this.db.prepare('DELETE FROM shadow_backups WHERE path_hash = ?').run(pathHash);
  }

  public close() {
    // DatabaseSync does not have a close method, it is garbage collected or closes on process exit.
    // However, some versions have close(), let's check or handle gracefully.
    if ('close' in this.db && typeof this.db.close === 'function') {
      (this.db as any).close();
    }
  }
}
