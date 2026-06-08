// ── Tool definitions for the LLM ───────────────────────────────────────

import type { ToolDefinition, ToolMeta } from '../types.js'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  // ── Read tools (safe) ──
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Use for examining code. Supports line ranges to avoid loading huge files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file (relative to working dir or absolute)' },
          start_line: { type: 'number', description: 'Start line (1-indexed). Optional.' },
          end_line: { type: 'number', description: 'End line (1-indexed, inclusive). Optional.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and directories in a path. Use to understand project structure.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path. Defaults to working dir.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for files by glob pattern (e.g. "**/*.ts", "src/**/*.go").',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern' },
          base: { type: 'string', description: 'Base directory. Defaults to working dir.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Find files by exact name (basename match).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'File name to find' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Full-text search across the indexed codebase. Returns matched files with snippets. Use for finding references, definitions, usages.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (BM25)' },
          limit: { type: 'number', description: 'Max results. Default 20.' },
          language: { type: 'string', description: 'Filter by language (e.g. "rust", "python")' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Semantic search for code by meaning (requires indexed embeddings). Use when you want conceptually similar code.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language query' },
          limit: { type: 'number', description: 'Max results. Default 10.' },
        },
        required: ['query'],
      },
    },
  },

  // ── Write tools (moderate risk) ──
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file. Creates parent dirs. Backs up the previous version (shadow) for rollback. Will be shown to user for review before committing.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Replace exact text in a file. Safer than write_file for targeted edits. Backs up original.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          target: { type: 'string', description: 'Exact text to find (must match exactly once)' },
          replacement: { type: 'string', description: 'New text' },
        },
        required: ['path', 'target', 'replacement'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_dependents',
      description: 'Find files that depend on (import/include) a given file. Use before editing shared modules.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_dependencies',
      description: 'Find files that a given file depends on (imports/includes).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'impact_analysis',
      description: 'Show the impact radius of changing a file (transitive dependents).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
        },
        required: ['path'],
      },
    },
  },

  // ── Execute tools (dangerous) ──
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in a kernel-isolated sandbox (Landlock + Seccomp). Network is denied by default. Use for builds, tests, git operations, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
          allow_network: { type: 'boolean', description: 'Override network denial for this command' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web for up-to-date information, documentation, news, or general knowledge.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' }
        },
        required: ['query']
      }
    }
  },
]

export const TOOL_META: Record<string, ToolMeta> = {
  read_file:           { risk: 'safe',      category: 'read',    description: 'Read a file' },
  list_directory:      { risk: 'safe',      category: 'read',    description: 'List directory' },
  search_files:        { risk: 'safe',      category: 'read',    description: 'Glob search' },
  find_files:          { risk: 'safe',      category: 'read',    description: 'Find file' },
  search_code:         { risk: 'safe',      category: 'read',    description: 'Search code' },
  semantic_search:     { risk: 'safe',      category: 'analyze', description: 'Semantic search' },
  find_dependents:     { risk: 'safe',      category: 'analyze', description: 'Find dependents' },
  find_dependencies:   { risk: 'safe',      category: 'analyze', description: 'Find dependencies' },
  impact_analysis:     { risk: 'safe',      category: 'analyze', description: 'Impact analysis' },
  web_search:          { risk: 'safe',      category: 'read',    description: 'Web search' },
  write_file:          { risk: 'moderate',  category: 'write',   description: 'Write file' },
  patch_file:          { risk: 'moderate',  category: 'write',   description: 'Patch file' },
  run_command:         { risk: 'dangerous', category: 'execute', description: 'Run shell command' },
}

export const TOOL_NAMES = Object.keys(TOOL_META)
