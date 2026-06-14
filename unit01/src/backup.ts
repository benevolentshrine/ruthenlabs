import * as crypto from 'crypto';
import * as fs from 'fs';
import { IndexerDB } from './db.js';

export function getPathHash(filepath: string): string {
  return crypto.createHash('sha256').update(filepath).digest('hex').substring(0, 16);
}

export class ShadowBackupManager {
  private db: IndexerDB;

  constructor(db: IndexerDB) {
    this.db = db;
  }

  /**
   * Back up a file if it exists, before modifying it.
   */
  public backupFile(absolutePath: string) {
    if (!fs.existsSync(absolutePath)) {
      // If the file is newly created, we still store its path so /undo can delete it!
      const pathHash = getPathHash(absolutePath);
      this.db.upsertBackup({
        path_hash: pathHash,
        original_path: absolutePath,
        content: '__NEW_FILE__' // special sentinel indicating file didn't exist
      });
      return;
    }

    try {
      const content = fs.readFileSync(absolutePath, 'utf-8');
      const pathHash = getPathHash(absolutePath);
      this.db.upsertBackup({
        path_hash: pathHash,
        original_path: absolutePath,
        content
      });
    } catch (err) {
      console.error(`Failed to create shadow backup for ${absolutePath}:`, err);
    }
  }

  /**
   * Restore a backup from its path or path hash.
   */
  public restoreBackup(absolutePath: string): boolean {
    const pathHash = getPathHash(absolutePath);
    const backup = this.db.getBackup(pathHash);
    
    if (!backup) {
      return false;
    }

    try {
      if (backup.content === '__NEW_FILE__') {
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
        }
      } else {
        fs.writeFileSync(absolutePath, backup.content, 'utf-8');
      }
      this.db.removeBackup(pathHash);
      return true;
    } catch (err) {
      console.error(`Failed to restore backup for ${absolutePath}:`, err);
      return false;
    }
  }
}
