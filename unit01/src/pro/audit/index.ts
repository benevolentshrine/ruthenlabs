import * as crypto from 'crypto';
import { IndexerDB } from '../../core/database/db.js';
import { initializeAuditSchema } from './schema.js';
import { disconnectService } from '../connect/index.js';
import { ShadowBackupManager } from '../../core/database/backup.js';

export interface AuditRecord {
  id: string;
  timestamp: number;
  service: string; // 'slack', 'github', 'discord', 'telegram', 'notion', 'shell', 'file_write'
  operation: string; // e.g. 'post_message', 'create_issue', 'execute_script'
  target: string; // e.g. URL, file path, channel name
  payload_summary: string;
  payload_hash: string;
  status: 'approved' | 'denied' | 'failed' | 'completed';
  duration_ms?: number;
}

export class AuditLogStore {
  private db: IndexerDB;

  constructor(db: IndexerDB) {
    this.db = db;
    initializeAuditSchema(this.db.db);
  }

  /**
   * Log an audited operation execution.
   */
  public logAction(record: Omit<AuditRecord, 'id' | 'timestamp'>): string {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    this.db.db.prepare(`
      INSERT INTO audit_logs (id, timestamp, service, operation, target, payload_summary, payload_hash, status, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      timestamp,
      record.service,
      record.operation,
      record.target,
      record.payload_summary,
      record.payload_hash,
      record.status,
      record.duration_ms || null
    );

    return id;
  }

  /**
   * Fetch the last N audit log entries.
   */
  public getRecentLogs(limit = 15): AuditRecord[] {
    return this.db.db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as AuditRecord[];
  }

  /**
   * Load details of a specific audit log by ID.
   */
  public getLogDetails(id: string): AuditRecord | null {
    const row = this.db.db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id) as AuditRecord | undefined;
    return row || null;
  }

  /**
   * Revert an audited operation.
   * If it was a local file modification, reverts to the backup state.
   * If it was an API credentials connector, disconnects it.
   */
  public async undoAction(id: string): Promise<{ success: boolean; message: string }> {
    const record = this.getLogDetails(id);
    if (!record) {
      return { success: false, message: `Audit record ${id} not found.` };
    }

    if (record.status !== 'completed' && record.status !== 'approved') {
      return { success: false, message: `Only completed or approved actions can be reverted.` };
    }

    try {
      switch (record.service.toLowerCase()) {
        case 'file_write':
        case 'file_patch': {
          // Trigger indexer restoration via ShadowBackupManager
          const backupManager = new ShadowBackupManager(this.db);
          const restored = backupManager.restoreBackup(record.target);
          if (restored) {
            this.updateStatus(id, 'failed'); // Mark as reverted state
            return { success: true, message: `Successfully reverted file edits on ${record.target}.` };
          }
          return { success: false, message: `No shadow backup found for file ${record.target}.` };
        }
        case 'connect': {
          // If we connected a service, disconnect it to revert key access
          disconnectService(record.target);
          this.updateStatus(id, 'failed');
          return { success: true, message: `Disconnected credentials for service: ${record.target}` };
        }
        default:
          return {
            success: false,
            message: `Undo for service ${record.service} is not supported directly. Manual adjustments required.`
          };
      }
    } catch (err) {
      return { success: false, message: `Undo failed: ${(err as Error).message}` };
    }
  }

  /**
   * Update status of an audit log entry.
   */
  private updateStatus(id: string, status: string): void {
    this.db.db.prepare('UPDATE audit_logs SET status = ? WHERE id = ?').run(status, id);
  }
}
