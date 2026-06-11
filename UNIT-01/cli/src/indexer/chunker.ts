import { extname, basename } from 'path';

export enum ChunkType {
  Function = 'Function',
  Class = 'Class',
  Module = 'Module',
  Block = 'Block',
}

export interface Chunk {
  chunk_id: string;
  filepath: string;
  relative_path: string;
  language: string;
  start_line: number;
  end_line: number;
  content: string;
  chunk_type: ChunkType;
  name: string | null;
}

interface Pattern {
  re: RegExp;
  chunk_type: ChunkType;
}

function pat(regexStr: string, type: ChunkType): Pattern {
  return {
    re: new RegExp(regexStr),
    chunk_type: type,
  };
}

const LANGUAGES_PATTERNS: Record<string, Pattern[]> = {
  Rust: [
    pat('^fn\\s+', ChunkType.Function),
    pat('^pub\\s+fn\\s+', ChunkType.Function),
    pat('^pub\\s+(unsafe\\s+)?fn\\s+', ChunkType.Function),
    pat('^struct\\s+\\w+', ChunkType.Class),
    pat('^enum\\s+\\w+', ChunkType.Class),
    pat('^impl\\s+', ChunkType.Class),
    pat('^trait\\s+\\w+', ChunkType.Class),
    pat('^mod\\s+\\w+', ChunkType.Block),
    pat('^macro_rules!\\s+\\w+', ChunkType.Function),
    pat('^#\\[test\\]\\s*$', ChunkType.Function),
    pat('^pub\\s+(async\\s+)?fn\\s+', ChunkType.Function),
  ],
  Python: [
    pat('^def\\s+', ChunkType.Function),
    pat('^async\\s+def\\s+', ChunkType.Function),
    pat('^class\\s+\\w+', ChunkType.Class),
    pat('^@\\w+\\.?(?:setter|deleter|getter)?\\s*$', ChunkType.Function),
  ],
  JavaScript: [
    pat('^function\\s+', ChunkType.Function),
    pat('^export\\s+(default\\s+)?function\\s+', ChunkType.Function),
    pat('^(export\\s+)?(async\\s+)?function\\s+', ChunkType.Function),
    pat('^(export\\s+)?class\\s+\\w+', ChunkType.Class),
    pat('^\\w+\\s*=\\s*(async\\s+)?function', ChunkType.Function),
  ],
  TypeScript: [
    pat('^function\\s+', ChunkType.Function),
    pat('^export\\s+(default\\s+)?function\\s+', ChunkType.Function),
    pat('^(export\\s+)?(async\\s+)?function\\s+', ChunkType.Function),
    pat('^(export\\s+)?class\\s+\\w+', ChunkType.Class),
    pat('^(export\\s+)?interface\\s+\\w+', ChunkType.Class),
    pat('^(export\\s+)?type\\s+\\w+\\s*=', ChunkType.Class),
    pat('^(export\\s+)?enum\\s+\\w+', ChunkType.Class),
    pat('^(export\\s+)?abstract\\s+class\\s+\\w+', ChunkType.Class),
    pat('^\\w+\\s*\\([^)]*\\)\\s*\\{[^}]*\\}$', ChunkType.Function),
    pat('^\\w+\\s*=\\s*(async\\s+)?\\([^)]*\\)\\s*=>', ChunkType.Function),
    pat('^\\w+\\s*=\\s*(async\\s+)?function', ChunkType.Function),
  ],
  Go: [
    pat('^func\\s+', ChunkType.Function),
    pat('^type\\s+\\w+\\s+struct', ChunkType.Class),
    pat('^type\\s+\\w+\\s+interface', ChunkType.Class),
  ],
  Java: [
    pat('^(public|private|protected)\\s+\\w+\\s+\\w+\\s*\\(', ChunkType.Function),
    pat('^(public|private|protected)\\s+class\\s+\\w+', ChunkType.Class),
    pat('^(public|private|protected)\\s+interface\\s+\\w+', ChunkType.Class),
    pat('^(public|private|protected)\\s+enum\\s+\\w+', ChunkType.Class),
    pat('@\\w+', ChunkType.Function),
  ],
  C: [
    pat('^\\w+\\s+\\w+\\s*\\(', ChunkType.Function),
    pat('^\\w+\\s+\\*\\s*\\w+\\s*\\(', ChunkType.Function),
    pat('^struct\\s+\\w+', ChunkType.Class),
  ],
  'C++': [
    pat('^\\w+\\s+\\w+\\s*\\(', ChunkType.Function),
    pat('^\\w+\\s+\\*\\s*\\w+\\s*\\(', ChunkType.Function),
    pat('^class\\s+\\w+', ChunkType.Class),
    pat('^struct\\s+\\w+', ChunkType.Class),
  ],
  Ruby: [
    pat('^def\\s+', ChunkType.Function),
    pat('^class\\s+\\w+', ChunkType.Class),
    pat('^module\\s+\\w+', ChunkType.Block),
  ],
  Kotlin: [
    pat('^fun\\s+', ChunkType.Function),
    pat('^class\\s+\\w+', ChunkType.Class),
    pat('^interface\\s+\\w+', ChunkType.Class),
    pat('^object\\s+\\w+', ChunkType.Class),
  ],
  Swift: [
    pat('^func\\s+', ChunkType.Function),
    pat('^class\\s+\\w+', ChunkType.Class),
    pat('^struct\\s+\\w+', ChunkType.Class),
    pat('^enum\\s+\\w+', ChunkType.Class),
    pat('^protocol\\s+\\w+', ChunkType.Class),
  ],
  PHP: [
    pat('^function\\s+', ChunkType.Function),
    pat('^(public|private|protected)\\s+function\\s+', ChunkType.Function),
    pat('^class\\s+\\w+', ChunkType.Class),
    pat('^interface\\s+\\w+', ChunkType.Class),
    pat('^trait\\s+\\w+', ChunkType.Class),
  ],
  Shell: [
    pat('^\\w+\\s*\\(\\)\\s*\\{', ChunkType.Function),
    pat('^function\\s+\\w+\\s*\\{', ChunkType.Function),
  ],
  Lua: [
    pat('^function\\s+', ChunkType.Function),
    pat('^(local\\s+)?function\\s+', ChunkType.Function),
  ],
  Zig: [
    pat('^fn\\s+', ChunkType.Function),
    pat('^pub\\s+fn\\s+', ChunkType.Function),
    pat('^const\\s+\\w+\\s*=\\s*struct', ChunkType.Class),
  ],
};

export function chunkFile(
  content: string,
  filepath: string,
  relativePath: string,
  language: string
): Chunk[] {
  const lines = content.split('\n');
  if (lines.length === 0) return [];

  const ext = extname(filepath).slice(1);
  const patterns = LANGUAGES_PATTERNS[language] || [];
  
  const boundaries: { line: number; type: ChunkType }[] = [{ line: 0, type: ChunkType.Module }];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    for (const pat of patterns) {
      if (pat.re.test(trimmed)) {
        boundaries.push({ line: i, type: pat.chunk_type });
        break;
      }
    }
  }

  // Sort and dedup boundaries by line
  boundaries.sort((a, b) => a.line - b.line);
  const uniqueBoundaries: typeof boundaries = [];
  let prevLine = -1;
  for (const b of boundaries) {
    if (b.line !== prevLine) {
      uniqueBoundaries.push(b);
      prevLine = b.line;
    }
  }

  if (uniqueBoundaries.length <= 1) {
    return [
      {
        chunk_id: relativePath,
        filepath,
        relative_path: relativePath,
        language,
        start_line: 0,
        end_line: lines.length - 1,
        content: content.trim(),
        chunk_type: ChunkType.Module,
        name: basename(filepath),
      },
    ];
  }

  const chunks: Chunk[] = [];
  
  for (let i = 0; i < uniqueBoundaries.length; i++) {
    const startLine = uniqueBoundaries[i].line;
    const endLine = i + 1 < uniqueBoundaries.length ? uniqueBoundaries[i + 1].line - 1 : lines.length - 1;
    
    const chunkContent = lines.slice(startLine, endLine + 1).join('\n').trim();
    if (!chunkContent) continue;

    chunks.push({
      chunk_id: `${relativePath}:${startLine}:${endLine}`,
      filepath,
      relative_path: relativePath,
      language,
      start_line: startLine,
      end_line: endLine,
      content: chunkContent,
      chunk_type: uniqueBoundaries[i].type,
      name: null,
    });
  }

  return chunks;
}

export function languageFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'rs': return 'Rust';
    case 'go': return 'Go';
    case 'py': return 'Python';
    case 'js':
    case 'jsx': return 'JavaScript';
    case 'ts':
    case 'tsx': return 'TypeScript';
    case 'java': return 'Java';
    case 'c':
    case 'h': return 'C';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'hpp': return 'C++';
    case 'rb': return 'Ruby';
    case 'php': return 'PHP';
    case 'swift': return 'Swift';
    case 'kt':
    case 'kts': return 'Kotlin';
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish': return 'Shell';
    case 'lua': return 'Lua';
    case 'zig': return 'Zig';
    default: return 'Unknown';
  }
}
