import * as crypto from 'crypto';
import { IndexerDB } from '../../core/database/db.js';
import { initializeMemorySchema } from './schema.js';

export interface ProjectDecision {
  id: string;
  timestamp: number;
  category: 'database' | 'auth' | 'styles' | 'conventions' | 'other';
  summary: string;
  rationale: string;
  context_files: string[]; // JSON stored string list
  active_session_id?: string;
}

export interface UserConvention {
  key: string;
  pattern: string;
  created_at: number;
  last_triggered: number;
}

export class ProjectMemoryStore {
  private db: IndexerDB;

  constructor(db: IndexerDB) {
    this.db = db;
    initializeMemorySchema(this.db.db);
  }

  /**
   * Log a new architectural decision to the persistent memory store.
   */
  public logDecision(decision: Omit<ProjectDecision, 'id' | 'timestamp'>): string {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const contextFilesStr = JSON.stringify(decision.context_files);

    this.db.db.prepare(`
      INSERT INTO project_decisions (id, timestamp, category, summary, rationale, context_files, active_session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      timestamp,
      decision.category,
      decision.summary,
      decision.rationale,
      contextFilesStr,
      decision.active_session_id || null
    );

    return id;
  }

  /**
   * Save or update a coding guideline/pattern convention.
   */
  public upsertConvention(key: string, pattern: string): void {
    const now = Date.now();
    this.db.db.prepare(`
      INSERT INTO user_conventions (key, pattern, created_at, last_triggered)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        pattern = excluded.pattern,
        last_triggered = excluded.last_triggered
    `).run(key, pattern, now, now);
  }

  /**
   * Fetch all stored decisions.
   */
  public getAllDecisions(): ProjectDecision[] {
    const rows = this.db.db.prepare('SELECT * FROM project_decisions ORDER BY timestamp DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      category: r.category,
      summary: r.summary,
      rationale: r.rationale,
      context_files: JSON.parse(r.context_files || '[]'),
      active_session_id: r.active_session_id
    }));
  }

  /**
   * Fetch all active coding conventions.
   */
  public getAllConventions(): UserConvention[] {
    return this.db.db.prepare('SELECT * FROM user_conventions ORDER BY last_triggered DESC').all() as UserConvention[];
  }

  /**
   * Format long-term decisions and style conventions into a system instruction context.
   */
  public generateMemoryContextBlock(): string {
    const decisions = this.getAllDecisions();
    const conventions = this.getAllConventions();

    if (decisions.length === 0 && conventions.length === 0) return '';

    let xml = '\n<project_memory>\n';

    if (conventions.length > 0) {
      xml += '  <style_conventions>\n';
      conventions.forEach(conv => {
        xml += `    - [${conv.key}]: "${conv.pattern}"\n`;
      });
      xml += '  </style_conventions>\n';
    }

    if (decisions.length > 0) {
      xml += '  <past_architectural_decisions>\n';
      // Show latest 10 decisions to prevent context bloat
      decisions.slice(0, 10).forEach(dec => {
        xml += `    - [${dec.category}] ${dec.summary} (Rationale: ${dec.rationale})\n`;
      });
      xml += '  </past_architectural_decisions>\n';
    }

    xml += '</project_memory>\n';
    return xml;
  }
}
