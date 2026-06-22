import * as path from 'path';
import { IndexerDB, ChunkRecord } from '../database/db.js';

// Rough token estimation: 4 characters per token
const MAX_CHAR_LIMIT = 1500 * 4;

function getSpecialTypeSuffix(filepath: string): string | null {
  const ext = path.extname(filepath).toLowerCase();
  const base = path.basename(filepath).toLowerCase();

  if (ext === '.css' || ext === '.scss' || ext === '.sass') {
    return '[stylesheet]';
  }
  if (ext === '.json' || ext === '.toml' || ext === '.yaml' || ext === '.yml' || base === 'package.json') {
    return '[config]';
  }
  if (ext === '.md' || ext === '.txt') {
    return '[docs]';
  }
  if (base.startsWith('.env')) {
    return '[env]';
  }
  return null;
}

function cleanSignature(content: string, name: string, type: 'function' | 'class'): string {
  const firstLine = content.split('\n')[0].trim();
  // Strip trailing opening braces, equals signs, or arrow syntax
  let sig = firstLine.replace(/[\{\=\s]+$/, '').replace(/\s*\=\s*$/, '').trim();
  
  if (type === 'class') {
    // If it doesn't already contain class word, format nicely
    if (!sig.includes('class ')) {
      return `class ${name}`;
    }
  }
  return sig;
}

export function buildRepoMap(db: IndexerDB): string {
  // 1. Get all files sorted by modified timestamp DESC
  const files = db.getAllFiles().sort((a, b) => b.modified - a.modified);
  
  let mapLines: string[] = [];
  let currentLength = 0;
  let omittedCount = 0;

  for (const file of files) {
    const relpath = path.relative(db.workspaceRoot, file.path); // Already relative or direct key
    const specialSuffix = getSpecialTypeSuffix(relpath);

    let fileEntry = '';
    if (specialSuffix) {
      fileEntry = `${relpath} → ${specialSuffix}`;
    } else {
      // Fetch symbols
      const chunks = db.getChunksForFile(file.path);
      // Group by AST function / class
      const symbols = chunks.filter(c => c.chunk_type === 'function' || c.chunk_type === 'class') as (ChunkRecord & { chunk_type: 'function' | 'class' })[];
      
      if (symbols.length === 0) {
        fileEntry = `${relpath}`;
      } else {
        const sigs = symbols.map(s => {
          const sig = cleanSignature(s.content, s.name, s.chunk_type);
          return `  → ${sig}`;
        });
        fileEntry = `${relpath}\n${sigs.join('\n')}`;
      }
    }

    // Add entry if it doesn't overflow character limit
    const addedLength = fileEntry.length + 2; // + newline
    if (currentLength + addedLength <= MAX_CHAR_LIMIT) {
      mapLines.push(fileEntry);
      currentLength += addedLength;
    } else {
      omittedCount++;
    }
  }

  if (omittedCount > 0) {
    mapLines.push(`\n... [${omittedCount} more files omitted to fit within token limit]`);
  }

  return mapLines.join('\n');
}
