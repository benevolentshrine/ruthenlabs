// ── Tool definitions for the LLM ───────────────────────────────────────

import type { ToolDefinition, ToolMeta } from '../types.js'

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. Caps response at 200 lines maximum to protect context window.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file (relative or absolute)' },
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
      name: 'write_file',
      description: 'Write complete content to a file. Performs auto-backups and shows diff before execution.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          content: { type: 'string', description: 'Complete file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Replace exact text in a file. Safer than write_file for targeted edits. Requires the target text to appear exactly once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          target: { type: 'string', description: 'Exact text to find (must match exactly once)' },
          replacement: { type: 'string', description: 'New replacement text' },
        },
        required: ['path', 'target', 'replacement'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_file_blocks',
      description: 'Safer multi-block patch edits. Replaces search block sections using standard <<<<<<< SEARCH, =======, and >>>>>>> REPLACE markers. Provide sufficient unique lines inside the SEARCH block so it matches exactly once.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          blocks: { type: 'string', description: 'Search/Replace block diff text (containing SEARCH/REPLACE segments)' },
        },
        required: ['path', 'blocks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Run a shell command in the sandbox. Cap output to 2000 chars. 30s timeout max.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search indexed codebase using SQLite FTS5 BM25. Max 10 results returned.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and directories in a path (1 level deep, max 100 entries).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path. Optional (defaults to working dir).' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Get structured JSON git status including branch, modified, and untracked files.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'diagnostics',
      description: 'Run compilation or linter diagnostics on the project to check for errors.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
]

export const TOOL_META: Record<string, ToolMeta> = {
  read_file:     { risk: 'safe',      category: 'read',    description: 'Read file content (max 200 lines)' },
  write_file:    { risk: 'moderate',  category: 'write',   description: 'Write file content' },
  patch_file:    { risk: 'moderate',  category: 'write',   description: 'Patch file content' },
  patch_file_blocks: { risk: 'moderate',  category: 'write',   description: 'Patch file using Search/Replace blocks' },
  run_command:   { risk: 'dangerous', category: 'execute', description: 'Run command in sandbox' },
  search_code:   { risk: 'safe',      category: 'read',    description: 'FTS5 search' },
  list_dir:      { risk: 'safe',      category: 'read',    description: 'List directory content (1 level)' },
  git_status:    { risk: 'safe',      category: 'read',    description: 'Get git status' },
  diagnostics:   { risk: 'safe',      category: 'analyze', description: 'Run project diagnostics' },
}

export const TOOL_NAMES = Object.keys(TOOL_META)
