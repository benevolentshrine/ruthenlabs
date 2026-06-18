import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { DirectiveIndexer } from './indexer.js';
import { DirectiveSandbox, redactSecrets } from './sandbox.js';
import { ollama } from './llm.js';
import { buildRepoMap } from './repomap.js';
import { marked } from 'marked';
// @ts-ignore
import { markedTerminal } from 'marked-terminal';
import { highlight as highlightCli } from 'cli-highlight';
import { AllowedPath } from './types.js';

let activeAllowedPaths: AllowedPath[] = [];
let isNonInteractive = false;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Theme definition (Glacier & Steel Blue theme)
const themePrimary = chalk.hex('#60A5FA'); // Glacier Steel Blue
const themeBorder = chalk.hex('#334155'); // Slate Blue for structural borders
const themeGreen = chalk.hex('#2DD4BF'); // Icy Teal / Mint for success
const themeGreenLight = chalk.hex('#93C5FD'); // Sky Mist for info
const themeOrange = chalk.hex('#F59E0B'); // Warm Amber for progress
const themeGray = chalk.hex('#64748B'); // Cool Slate Gray
const themeRed = chalk.hex('#FB7185'); // Icy Rose / Crimson for errors
const themeBgDeep = '#0F172A'; // Slate 900 for dark background highlights

// Helper to count visual lines of text given the terminal width
function countVisualLines(text: string, cols: number): number {
  const lines = text.split('\n');
  let totalLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ');
    const clean = line.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    const len = (i === 0 ? clean.length + 2 : clean.length);
    if (len === 0) {
      totalLines += 1;
    } else {
      totalLines += Math.ceil(len / cols);
    }
  }
  return totalLines;
}

// Helper to detect if the streamed text contains a repetition loop
function hasRepetitionLoop(text: string): boolean {
  const len = text.length;
  // Look for repeating suffixes of length 10 to 200 characters
  // A repeat loop exists if s1 === s2 && s2 === s3
  const maxChunkSize = Math.min(200, Math.floor(len / 3));
  for (let size = 10; size <= maxChunkSize; size++) {
    const chunk3 = text.slice(-size);
    const chunk2 = text.slice(-2 * size, -size);
    const chunk1 = text.slice(-3 * size, -2 * size);
    if (chunk1 === chunk2 && chunk2 === chunk3) {
      // Must contain at least one letter and have a character variety of at least 3 unique characters
      // to avoid false positives on formatting lines (e.g. dashes, equals, spaces).
      if (/[a-zA-Z]/.test(chunk3) && new Set(chunk3).size > 2) {
        return true;
      }
    }
  }

  // Also check if the last 4 non-empty lines are identical
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length >= 4) {
    const last4 = lines.slice(-4);
    if (last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
      const line = last4[0];
      if (line.length >= 3 && /[a-zA-Z]/.test(line) && new Set(line).size > 2) {
        return true;
      }
    }
  }

  return false;
}

class ThinkingSpinner {
  private words: string[];
  private intervalId: NodeJS.Timeout | null = null;
  private currentWord = '';
  private dotCount = 0;
  private active = false;

  constructor() {
    this.words = [
      "Thinking", "Bamboozling", "Fantasizing", "Synthesizing", "Compiling",
      "Refactoring", "Indexing", "Pondering", "Consulting the oracle", "Generating bugs",
      "Solving P vs NP", "Baking cookies", "Brewing coffee", "Hacking the mainframe", "Optimizing the indexer",
      "Running Seatbelt", "Escaping FTS5 queries", "Counting tokens", "Compiling TypeScript", "Tuning hyper-parameters",
      "Analyzing AST", "Diffing changes", "Redacting secrets", "Truncating logs", "Checking egress proxy",
      "Simulating consciousness", "Aligning vectors", "Querying SQLite", "Debouncing file watch", "Garbage collecting",
      "Calibrating flux capacitor", "Deciphering codebase", "Caching responses", "Minifying bundle", "Resolving dependencies",
      "Bootstrapping sandbox", "Parsing signatures", "Building repo map", "Invoking tree-sitter", "Spawning processes",
      "Running tests", "Reading database", "Calculating embeddings", "Reranking chunks", "Searching FTS index",
      "Undoing last command", "Clearing loop history", "Checking package-lock.json", "Analyzing imports", "Scanning workspace",
      "Polishing UI", "Centering mascot", "Drawing steel blue boxes", "Reflowing text", "Redrawing border",
      "Adjusting seatbelt profile", "Starting bubblewrap", "Verifying egress whitelist", "Compacting chat history", "Streaming tokens",
      "Detecting infinite loops", "Taming local models", "Optimizing context size", "Loading weights", "Quantizing gradients",
      "Finetuning neurons", "Activating self-repair", "Debugging compiler errors", "Linting files", "Locating source maps",
      "Preheating CPU", "Spinning up sandbox", "Allocating virtual memory", "Checking file descriptors", "Enforcing ulimits",
      "Resolving symlinks", "Sanitizing input", "Redacting API keys", "Reading git branch", "Estimating token usage",
      "Formatting markdown", "Injecting system prompt", "Filtering parameters", "Hashing file changes", "Tracing call graph",
      "Calculating semantic similarity", "Generating code snippets", "Validating syntax", "Normalizing text", "Splitting chunks",
      "Pruning repository map", "Benchmarking performance", "Reducing latency", "Warming cache", "Clearing screen down",
      "Moving cursor", "Styling terminal", "Loading qwen2.5-coder", "Running Ollama", "Parsing JSON response",
      "Decrypting secrets", "Inspecting heap memory", "Detecting memory leaks", "Evaluating Seatbelt rules", "Restoring backup",
      "Compiling WebAssembly", "Optimizing AST queries", "Formatting tables", "Coloring console logs", "Handling resize event",
      "Querying model info", "Finding context length", "Checking git status", "Fetching git diff", "Parsing CLI arguments",
      "Generating shell script", "Managing background tasks", "Listening to stdin", "Handling exit signals", "Graceful shutdown",
      "Resolving relative paths", "Replacing ANSI escapes", "Stripping XML tags", "Formatting bullet points", "Configuring marked options",
      "Setting chalk colors", "Wrapping long lines", "Padding code blocks", "Tuning temperature", "Generating next token",
      "Predicting next word", "Calculating probabilities", "Filtering logits", "Sampling completions", "Polishing code block padding",
      "Centering welcome banner", "Making UI look premium", "Wowing the user", "Avoiding generic red and green", "Tailoring HSL colors",
      "Adding micro-animations", "Implementing modern design", "Flipping agency model", "Preparing workspace", "Tracking deltas",
      "Pruning FTS index", "Re-indexing modified files", "Compacting database", "Vacuuming SQLite", "Flushing write-ahead log",
      "Resolving biological ontologies", "Searching PDB templates", "Calling foldseek API", "Extracting genetic variant effects",
      "Retrieving clinical trials", "Parsing dbSNP database", "Extracting UniProt accession attributes", "Querying ChEMBL properties",
      "Fetching GTEx tissue expressions", "Looking up string interactions", "Loading UCSC conservation scores", "Distilling workflow into reusable skill"
    ];
    this.words = this.words.sort(() => Math.random() - 0.5);
  }

  public start() {
    if (this.active) return;
    this.active = true;
    this.currentWord = this.words[Math.floor(Math.random() * this.words.length)];
    this.dotCount = 0;
    
    let ticks = 0;
    this.intervalId = setInterval(() => {
      ticks++;
      if (ticks % 10 === 0) {
        this.currentWord = this.words[Math.floor(Math.random() * this.words.length)];
      }
      this.dotCount = (this.dotCount + 1) % 4;
      
      const dots = ".".repeat(this.dotCount).padEnd(3, " ");
      const text = ` ${themeOrange('●')} ${themeGray(this.currentWord + dots)}`;
      
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(text);
    }, 200);
  }

  public stop() {
    if (!this.active) return;
    this.active = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
  }
}

function interactiveSelect(title: string, options: string[]): Promise<number> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    
    if (typeof stdin.setRawMode !== 'function') {
      // Non-TTY fallback
      console.log(`\n${themePrimary.bold(title)}`);
      options.forEach((opt, idx) => console.log(`  ${idx + 1}. ${opt}`));
      resolve(0);
      return;
    }
    
    let selectedIndex = 0;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);
    
    // Hide cursor
    stdout.write('\u001b[?25l');
    
    const render = () => {
      stdout.write('\r\n' + themePrimary.bold(title) + '\r\n');
      options.forEach((opt, idx) => {
        if (idx === selectedIndex) {
          stdout.write(`  ${themeGreen('●')} ${chalk.bgHex('#6B21A8').white(' ' + opt + ' ')}\r\n`);
        } else {
          stdout.write(`    ${chalk.gray(opt)}\r\n`);
        }
      });
    };
    
    const clear = () => {
      const linesToMove = options.length + 2;
      readline.moveCursor(stdout, 0, -linesToMove);
      readline.cursorTo(stdout, 0);
      readline.clearScreenDown(stdout);
    };
    
    render();
    
    const onKeypress = (str: any, key: any) => {
      if (key) {
        if (key.ctrl && key.name === 'c') {
          cleanup();
          process.exit(0);
        }
        
        if (key.name === 'escape' || key.name === 'q') {
          cleanup();
          resolve(-1);
        } else if (key.name === 'up') {
          selectedIndex = (selectedIndex - 1 + options.length) % options.length;
          clear();
          render();
        } else if (key.name === 'down') {
          selectedIndex = (selectedIndex + 1) % options.length;
          clear();
          render();
        } else if (key.name === 'return' || key.name === 'enter') {
          cleanup();
          resolve(selectedIndex);
        }
      }
    };
    
    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(wasRaw);
      // Restore cursor
      stdout.write('\u001b[?25h');
      clear();
    };
    
    stdin.on('keypress', onKeypress);
  });
}

// Setup marked renderer
const markedRenderer = markedTerminal({
  heading: (text: string) => themePrimary.bold(text),
  firstHeading: (text: string) => themePrimary.bold.underline(text),
  blockquote: chalk.gray.italic,
  listitem: (text: string) => text,
  tableOptions: {
    style: {
      head: ['magenta'],
      border: ['gray']
    }
  },
  codespan: (text: string) => themeGreenLight.bgHex(themeBgDeep)(' ' + text + ' '),
});

// Override the code block renderer to use the beautiful padded dark block layout
// @ts-ignore
markedRenderer.renderer.code = function (code: any, lang?: string) {
  let text = '';
  let language = '';
  if (typeof code === 'object' && code !== null) {
    language = code.lang || '';
    text = code.text;
  } else {
    language = lang || '';
    text = code;
  }

  let highlighted = text;
  try {
    highlighted = highlightCli(text, { language });
  } catch (e) {
    highlighted = chalk.yellow(text);
  }

  const lines = highlighted.split('\n');
  const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const visualLengths = lines.map(line => stripAnsi(line.replace(/\t/g, '    ')).length);
  const maxLineLen = Math.max(...visualLengths, 0);

  const cols = process.stdout.columns || 80;
  const maxCodeWidth = cols - 8;
  const padWidth = Math.min(Math.max(maxLineLen + 4, 40), maxCodeWidth);

  const bgOpen = '\u001b[48;2;30;30;30m'; // #1E1E1E background
  const ansiReset = '\u001b[0m'; // Full reset

  const topBottomPadding = '  ' + bgOpen + ' '.repeat(padWidth) + ansiReset;
  const styledLines = lines.map(line => {
    const expanded = line.replace(/\t/g, '    ');
    const len = stripAnsi(expanded).length;
    const padding = ' '.repeat(Math.max(padWidth - len, 0));
    return '  ' + bgOpen + line.replaceAll(ansiReset, ansiReset + bgOpen) + padding + ansiReset;
  });

  return '\n' + [topBottomPadding, ...styledLines, topBottomPadding].join('\n') + '\n\n';
};

marked.use(markedRenderer);

// System prompt instructing local model on tool-calling behavior
const SYSTEM_INSTRUCTIONS = `You are Unit01, a directive AI coding assistant.
You can execute tools by wrapping commands in specific XML tags. Here are concrete examples of how to invoke them:

- To run a shell command: <run_command>npm test</run_command>
- To read a file: <read_file>src/db.ts</read_file>
- To write or overwrite a new file: <write_file path="src/main.ts">console.log("hello");</write_file>
- To search the codebase: <search_code>DatabaseSync</search_code>
- To patch a single exact string occurrence in a file:
  <patch_file path="src/main.ts" search="console.log(&quot;hello&quot;);" replace="console.log(&quot;hi&quot;);" />
  Or nested format:
  <patch_file path="src/main.ts">
    <search>console.log("hello");</search>
    <replace>console.log("hi");</replace>
  </patch_file>
- To perform multi-block edits on an existing file:
  <patch_file_blocks path="src/main.ts">
  <<<<<<< ORIGINAL
  console.log("hello");
  =======
  console.log("hi");
  >>>>>>> UPDATED
  </patch_file_blocks>
- To list directory contents directly: <list_dir path="src" recursive="false" />
- To view structured git status: <git_status />
- To run project compilation/linter diagnostics: <diagnostics /> or <diagnostics command="npm run lint" />
- To rename or move a file: <move_file source_path="old.py" destination_path="new.py" />
- To ask the developer a question or request path permission (substitute the target path dynamically):
  <question options="Allow read-write, Allow read-only, Deny">I need access to /path/to/directory to complete this task. Grant access?</question>

Rules:
1. Execute only ONE tool at a time.
2. Once you write a tool call tag, stop outputting text immediately. Wait for the tool output to be returned to you in a <tool_output> block. Do NOT write any conversational text, preambles, or introductory explanations (such as "To read the file...", "You can run this command...", etc.) before writing the XML tool tag. Simply output the XML tool tag directly.
3. Do not write placeholders like "relative_path". Write the actual path directly.
4. Keep your explanations concise, professional, and code-focused.
5. Before executing any file, ensure it has been written using write_file first. Always use absolute paths.
6. Tool Selection Priority:
   - Use patch_file_blocks as the default tool to edit existing files.
   - Use patch_file for simple, single exact replacements.
   - Use write_file only when creating new files. Never write_file on an existing file.
   - Use move_file to rename or move files. Never use cp + rm or mv in run_command.
   - You MUST use the <question> tool to request path access if you need to access files outside the workspace. Do NOT request path access, ask questions, or clarify requirements via plain conversational text, as the user has no way to grant permissions or respond unless you invoke the <question> tool tag.
7. Complex Task / New Project Workflow:
   - When asked to create a new application, website, game, or implement a large feature, DO NOT write files immediately.
   - First, present a clear architectural plan detailing the files you plan to create/modify and libraries you need. Wait for user approval or feedback.
   - After approval, implement the code incrementally—write or edit only ONE file per turn, starting with the base configuration and core logic.
   - Keep code modular and clean. Separate concerns (e.g., separate UI rendering from core logic) to prevent massive single-file dumps.
8. To access files or directories outside the workspace (such as the home directory), first attempt to access them using filesystem tools (e.g. <list_dir path="${os.homedir()}" />) or commands. If the tool fails with a PATH_NOT_ALLOWED error, copy the exact path from the error response and immediately request access using the question tool (e.g., <question options="Allow read-write, Allow read-only, Deny">I need access to ${os.homedir()} to complete this task. Grant access?</question>). You MUST use the <question> tool tag; do NOT attempt to request permission or ask for access using plain conversational text.
9. When using the <question> tool to request path permission, always substitute the target path dynamically (do not literally copy "/path/to/directory" from the example; use the actual absolute path you need to access, e.g. "${os.homedir()}").
`;

let lastWrittenFile: {
  filePath: string;
  original: string | null;
  content: string;
} | null = null;

function getGitBranch(workspaceRoot: string): string {
  try {
    return execSync('git branch --show-current', { cwd: workspaceRoot, stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return 'main';
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function cleanFilePath(p: string): string {
  let cleaned = p.trim();
  // Strip relative_path=" or path=" attribute wrapper if present
  const attrRegex = /^(?:relative_)?path\s*=\s*['"]?([^'"]+)['"]?$/i;
  const match = attrRegex.exec(cleaned);
  if (match) {
    cleaned = match[1];
  }
  // Remove surrounding quotes
  cleaned = cleaned.replace(/^['"]|['"]$/g, '');
  return cleaned.trim();
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative === '') return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}


function cleanContentFences(content: string): string {
  const trimmed = content.trim();
  const fenceRegex = /^`{3,}[\w\-]*\r?\n([\s\S]*?)\r?\n`{3,}$/;
  const match = fenceRegex.exec(trimmed);
  if (match) {
    return match[1];
  }
  return content;
}

const HALLUCINATED_TAGS = new Set([
  'delete_file', 'remove_file', 'create_file', 'copy_file', 'rename_file', 'list_files',
  'read_directory', 'list_directory', 'create_directory', 'make_directory', 'delete_directory',
  'delete_folder', 'move_folder', 'create_folder', 'rename_folder', 'list_folder',
  'run_script', 'exec_command', 'execute_command', 'execute_script',
  'mkdir', 'rm', 'mv', 'cp', 'ls', 'cd', 'pwd', 'file_write', 'file_read', 'file_delete',
  'write_directory', 'patch_file', 'edit_file', 'modify_file'
]);

function isHallocinatedTool(tagName: string): boolean {
  const clean = tagName.toLowerCase().replace(/^\//, ''); // strip leading slash for closing tags
  if (HALLUCINATED_TAGS.has(clean)) return true;
  if (clean.endsWith('_file') || clean.endsWith('_dir') || clean.endsWith('_directory') || clean.endsWith('_folder') || clean.endsWith('_command') || clean.endsWith('_path')) {
    // Exclude allowed tags
    const allowed = new Set(['run_command', 'read_file', 'write_file', 'search_code', 'think']);
    return !allowed.has(clean);
  }
  return false;
}

const TOOL_SIGNATURES: Record<string, { desc: string; args: string }> = {
  'run_command': {
    desc: "Executes a shell command in the sandbox.",
    args: "command (string, content of the tag)"
  },
  'read_file': {
    desc: "Reads the content of a file in the workspace.",
    args: "path (string, attribute or content)"
  },
  'write_file': {
    desc: "Writes content to a file in the workspace.",
    args: "path (string, attribute or content), content (string, content of the tag)"
  },
  'search_code': {
    desc: "Searches the codebase index using keyword/FTS matching.",
    args: "query (string, content of the tag)"
  },
  'patch_file': {
    desc: "Replaces an exact string occurrence in a file.",
    args: "path (string, required), search (string, required), replace (string, required)"
  },
  'patch_file_blocks': {
    desc: "Multi-block search/replace using diff markers.",
    args: "path (string, required), diff (string, required)"
  },
  'list_dir': {
    desc: "Lists files and directories at a path.",
    args: "path (string, required), recursive (boolean, optional)"
  },
  'git_status': {
    desc: "Returns structured git status for the workspace.",
    args: "none"
  },
  'diagnostics': {
    desc: "Runs linter or compiler checks and returns structured results.",
    args: "command (string, optional)"
  },
  'move_file': {
    desc: "Renames/moves a file and updates indexing, backups, and sandbox tracking.",
    args: "source_path (string, required), destination_path (string, required)"
  },
  'question': {
    desc: "Asks the developer a question or requests access permission to a directory path outside the workspace.",
    args: "question (string, required), options (string, comma-separated, optional)"
  },
  'sandbox_exec': {
    desc: "Executes code in a sandboxed environment.",
    args: "code (string), language (string), timeout_ms (number, optional)"
  }
};

function parseAttributes(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_\-]+)=["']([^"']*)["']/g;
  let match;
  while ((match = regex.exec(attrStr))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function validateToolCall(tagName: string, attributesStr: string): string | null {
  const attrs = parseAttributes(attributesStr);
  const attrKeys = Object.keys(attrs);

  const isAllowed = new Set(['run_command', 'read_file', 'write_file', 'search_code', 'patch_file', 'patch_file_blocks', 'list_dir', 'git_status', 'diagnostics', 'move_file', 'think', 'question', 'path_question']).has(tagName);

  if (!isAllowed) {
    const sig = TOOL_SIGNATURES[tagName];
    if (sig) {
      const validArgs = sig.args.split(', ').map(a => a.split(' ')[0]);
      const invalidArgs = attrKeys.filter(k => !validArgs.includes(k));
      if (invalidArgs.length > 0) {
        return JSON.stringify({
          error: `Tool '${tagName}' called with invalid argument '${invalidArgs[0]}'. Valid arguments are: ${sig.args}.`,
          code: "INVALID_TOOL_ARGUMENT"
        });
      }
      return JSON.stringify({
        error: `Unknown tool '${tagName}'. Valid arguments are: ${sig.args}.`,
        code: "UNKNOWN_TOOL"
      });
    } else {
      return JSON.stringify({
        error: `Unknown tool '${tagName}'. Supported tools are: run_command, read_file, write_file, search_code.`,
        code: "UNKNOWN_TOOL"
      });
    }
  }

  if (tagName === 'run_command') {
    if (attrKeys.length > 0) {
      return JSON.stringify({
        error: `Tool 'run_command' called with invalid argument '${attrKeys[0]}'. Valid arguments are: command (string, content of the tag).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'read_file') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'read_file' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, attribute or content).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'write_file') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'write_file' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, attribute or content), content (string, content of the tag).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'search_code') {
    if (attrKeys.length > 0) {
      return JSON.stringify({
        error: `Tool 'search_code' called with invalid argument '${attrKeys[0]}'. Valid arguments are: query (string, content of the tag).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'patch_file') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path' && k !== 'search' && k !== 'target' && k !== 'replace' && k !== 'replacement');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'patch_file' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required), search (string, required), replace (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'patch_file_blocks') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path' && k !== 'diff' && k !== 'blocks');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'patch_file_blocks' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required), diff (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'list_dir') {
    const invalid = attrKeys.filter(k => k !== 'path' && k !== 'relative_path' && k !== 'recursive');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'list_dir' called with invalid argument '${invalid[0]}'. Valid arguments are: path (string, required), recursive (boolean, optional).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'git_status') {
    if (attrKeys.length > 0) {
      return JSON.stringify({
        error: `Tool 'git_status' called with invalid argument '${attrKeys[0]}'. Valid arguments are: none.`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'diagnostics') {
    const invalid = attrKeys.filter(k => k !== 'command');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'diagnostics' called with invalid argument '${invalid[0]}'. Valid arguments are: command (string, optional).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'move_file') {
    const invalid = attrKeys.filter(k => k !== 'source_path' && k !== 'destination_path' && k !== 'src_path' && k !== 'dest_path' && k !== 'from' && k !== 'to');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool 'move_file' called with invalid argument '${invalid[0]}'. Valid arguments are: source_path (string, required), destination_path (string, required).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  } else if (tagName === 'question' || tagName === 'path_question') {
    const invalid = attrKeys.filter(k => k !== 'question' && k !== 'options');
    if (invalid.length > 0) {
      return JSON.stringify({
        error: `Tool '${tagName}' called with invalid argument '${invalid[0]}'. Valid arguments are: question (string, required), options (string, optional).`,
        code: "INVALID_TOOL_ARGUMENT"
      });
    }
  }

  return null;
}

function parseMoveFile(text: string): { sourcePath: string; destinationPath: string } | null {
  const matchAttr = /<move_file\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const sourceVal = attrs.source_path || attrs.src_path || attrs.from;
    const destVal = attrs.destination_path || attrs.dest_path || attrs.to;
    if (sourceVal && destVal) {
      return {
        sourcePath: cleanFilePath(sourceVal),
        destinationPath: cleanFilePath(destVal)
      };
    }
  }
  return null;
}

function parsePatchFile(text: string): { filePath: string; search: string; replace: string } | null {
  const matchAttr = /<patch_file\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const pathVal = attrs.path || attrs.relative_path;
    const searchVal = attrs.search || attrs.target;
    const replaceVal = attrs.replace || attrs.replacement;
    if (pathVal && searchVal !== undefined && replaceVal !== undefined) {
      return {
        filePath: cleanFilePath(pathVal),
        search: searchVal,
        replace: replaceVal
      };
    }
  }

  const matchNested = /<patch_file\s+([^>]+)\s*>([\s\S]*?)<\/patch_file>/.exec(text);
  if (matchNested) {
    const attrs = parseAttributes(matchNested[1]);
    const pathVal = attrs.path || attrs.relative_path;
    const inner = matchNested[2];
    
    const searchMatch = /<search>([\s\S]*?)<\/search>/.exec(inner);
    const replaceMatch = /<replace>([\s\S]*?)<\/replace>/.exec(inner);
    
    if (pathVal && searchMatch && replaceMatch) {
      return {
        filePath: cleanFilePath(pathVal),
        search: searchMatch[1],
        replace: replaceMatch[1]
      };
    }
  }
  
  return null;
}

function parsePatchFileBlocks(text: string): { filePath: string; diff: string } | null {
  const match = /<patch_file_blocks\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/patch_file_blocks>|$)/.exec(text);
  if (match) {
    return {
      filePath: cleanFilePath(match[1]),
      diff: match[2].trim()
    };
  }
  return null;
}

function parseListDir(text: string): { pathVal: string; recursive: boolean } | null {
  const matchAttr = /<list_dir\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const pathVal = attrs.path || attrs.relative_path || '.';
    const recursive = attrs.recursive === 'true' || attrs.recursive === 'yes';
    return { pathVal: cleanFilePath(pathVal), recursive };
  }
  
  const matchTag = /<list_dir\s*>([\s\S]*?)(?:<\/list_dir>|$)/.exec(text);
  if (matchTag) {
    return {
      pathVal: cleanFilePath(matchTag[1]) || '.',
      recursive: false
    };
  }
  return null;
}

function parseGitStatus(text: string): boolean {
  return /<git_status\s*\/?>/.test(text) || /<git_status\s*>/.test(text);
}

function parseDiagnosticsTag(text: string): { command?: string } | null {
  const matchAttr = /<diagnostics\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    return { command: attrs.command };
  }
  const matchTag = /<diagnostics\s*>([\s\S]*?)(?:<\/diagnostics>|$)/.exec(text);
  if (matchTag) {
    const inner = matchTag[1].trim();
    return { command: inner || undefined };
  }
  if (/<diagnostics\s*\/?>/.test(text) || /<diagnostics\s*>/.test(text)) {
    return {};
  }
  return null;
}

export function applySearchReplaceBlocks(content: string, blocksStr: string): string {
  const lines = blocksStr.split('\n');
  const blocks: { search: string; replace: string }[] = [];
  
  let currentSearch: string[] = [];
  let currentReplace: string[] = [];
  let inSearch = false;
  let inReplace = false;
  let blockCount = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('<<<<<<< ORIGINAL')) {
      inSearch = true;
      inReplace = false;
      currentSearch = [];
      blockCount++;
    } else if (line.startsWith('=======')) {
      inSearch = false;
      inReplace = true;
      currentReplace = [];
    } else if (line.startsWith('>>>>>>> UPDATED')) {
      inSearch = false;
      inReplace = false;
      blocks.push({
        search: currentSearch.join('\n'),
        replace: currentReplace.join('\n'),
      });
    } else {
      if (inSearch) {
        currentSearch.push(line);
      } else if (inReplace) {
        currentReplace.push(line);
      }
    }
  }
  
  if (blocks.length === 0) {
    throw {
      message: "No valid ORIGINAL/UPDATED blocks found in the input. Format must use <<<<<<< ORIGINAL, =======, and >>>>>>> UPDATED.",
      code: "INVALID_PATCH_FORMAT"
    };
  }
  
  let updated = content;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.search.trim()) {
      throw {
        message: `Block ${i + 1} has an empty ORIGINAL block, which is not allowed.`,
        code: "EMPTY_PATCH_BLOCK",
        blockIndex: i + 1
      };
    }
    
    const index = updated.indexOf(block.search);
    if (index === -1) {
      const normalizedSearch = block.search.replace(/\r\n/g, '\n');
      const normalizedContent = updated.replace(/\r\n/g, '\n');
      const normIndex = normalizedContent.indexOf(normalizedSearch);
      
      if (normIndex === -1) {
        throw {
          message: `Could not find ORIGINAL block ${i + 1} in the file. Indentation and whitespace must match exactly.`,
          code: "PATCH_BLOCK_NOT_FOUND",
          blockIndex: i + 1,
          blockSearch: block.search
        };
      }
      
      updated = normalizedContent.slice(0, normIndex) + block.replace + normalizedContent.slice(normIndex + normalizedSearch.length);
    } else {
      updated = updated.slice(0, index) + block.replace + updated.slice(index + block.search.length);
    }
  }
  
  return updated;
}

function listDirectory(dirPath: string, workspaceRoot: string, recursive = false): { directories: any[]; files: any[] } {
  const directories: any[] = [];
  const files: any[] = [];

  function walk(currentDir: string) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(workspaceRoot, fullPath);
      
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fullPath);
      } catch (e) {
        continue;
      }

      if (entry.isDirectory()) {
        directories.push({
          name: entry.name,
          path: relPath,
          modified: stat.mtimeMs
        });
        if (recursive) {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        files.push({
          name: entry.name,
          path: relPath,
          size: stat.size,
          modified: stat.mtimeMs
        });
      }
    }
  }

  walk(dirPath);
  return { directories, files };
}

function parseDiagnostics(raw: string): { passed: boolean; errors: any[]; warnings: any[] } {
  const errors: any[] = [];
  const warnings: any[] = [];
  const lines = raw.split('\n');

  const regexes = [
    /^([a-zA-Z0-9_\-\./\s]+):(\d+):(\d+)\s+-\s+(error|warning)\s+(.*)$/i,
    /^([a-zA-Z0-9_\-\./\s]+):(\d+):(?:\d+:)?\s*(error|warning|err|warn)?\s*[:\-]?\s*(.*)$/i
  ];

  for (const line of lines) {
    let matched = false;
    for (const rx of regexes) {
      const m = rx.exec(line.trim());
      if (m) {
        const file = m[1].trim();
        const lineNum = parseInt(m[2], 10);
        const type = (m[4] || m[3] || 'error').toLowerCase();
        const message = (m[5] || m[4] || m[3] || '').trim();

        const item = { file, line: lineNum, message };
        if (type.includes('warn')) {
          warnings.push(item);
        } else {
          errors.push(item);
        }
        matched = true;
        break;
      }
    }
  }

  let passed = errors.length === 0;
  if (raw.toLowerCase().includes('error') || raw.toLowerCase().includes('failed') || raw.toLowerCase().includes('compilation failed')) {
    passed = false;
  }
  if (errors.length === 0 && !passed) {
    errors.push({ file: 'project', line: 1, message: 'Diagnostics command failed. See raw output.' });
  }

  return { passed, errors, warnings };
}

function parseWriteFile(text: string): { filePath: string; content: string } | null {
  // Try matching path attribute: <write_file path="src/index.ts">content</write_file>
  // or unclosed: <write_file path="src/index.ts">content (to end of text)
  const attrMatch = /<write_file\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/write_file>|$)/.exec(text);
  if (attrMatch) {
    return {
      filePath: cleanFilePath(attrMatch[1]),
      content: cleanContentFences(attrMatch[2])
    };
  }

  // Fallback if model omitted attribute: <write_file>src/index.ts\ncontent</write_file>
  // or unclosed: <write_file>src/index.ts\ncontent (to end of text)
  const tagMatch = /<write_file>([\s\S]*?)(?:<\/write_file>|$)/.exec(text);
  if (tagMatch) {
    const inner = tagMatch[1].trim();
    const firstNewline = inner.indexOf('\n');
    if (firstNewline !== -1) {
      const filePath = cleanFilePath(inner.slice(0, firstNewline));
      const content = inner.slice(firstNewline + 1);
      return { filePath, content: cleanContentFences(content) };
    }
  }

  return null;
}

function parseReadFile(text: string): string | null {
  // Try matching path attribute: <read_file path="src/index.ts">...</read_file> or <read_file path="src/index.ts" />
  const attrMatch = /<read_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(text);
  if (attrMatch) {
    return cleanFilePath(attrMatch[1]);
  }

  // Fallback to tag content: <read_file>src/index.ts</read_file>
  const tagMatch = /<read_file\s*>([\s\S]*?)(?:<\/read_file>|$)/.exec(text);
  if (tagMatch) {
    return cleanFilePath(tagMatch[1]);
  }

  return null;
}

function parseRunCommand(text: string): string | null {
  const tagMatch = /<run_command\s*>([\s\S]*?)(?:<\/run_command>|$)/.exec(text);
  if (tagMatch) {
    return tagMatch[1].trim();
  }
  return null;
}

function parseSearchCode(text: string): string | null {
  const tagMatch = /<search_code\s*>([\s\S]*?)(?:<\/search_code>|$)/.exec(text);
  if (tagMatch) {
    return tagMatch[1].trim();
  }
  return null;
}

function extractPathFromQuestion(question: string): string | null {
  const regex = new RegExp("(?:^|\\s|['\"`])(\\/[^'\"\\s]+|~\\/[^'\"\\s]+|~)");
  const match = question.match(regex);
  if (match) {
    let p = match[1];
    while (p && /[?.!,;]$/.test(p)) {
      p = p.slice(0, -1);
    }
    return p;
  }
  return null;
}

function parseQuestion(text: string): { question: string; options: string[] } | null {
  // 1. Try matching nested format: <question options="Allow read-write, Allow read-only, Deny">I need access...</question>
  const matchNested = /<(?:path_)?question(?:\s+([^>]*))?>([\s\S]*?)<\/(?:path_)?question>/.exec(text);
  if (matchNested) {
    const attrsStr = matchNested[1] || '';
    const innerContent = matchNested[2].trim();
    if (innerContent) {
      const attrs = parseAttributes(attrsStr);
      const optionsVal = attrs.options;
      const options = optionsVal
        ? optionsVal.split(',').map(o => o.trim())
        : ['Yes', 'No'];
      return {
        question: innerContent,
        options
      };
    }
  }

  // 2. Fallback to matching attribute format: <question question="..." options="..." />
  const matchAttr = /<(?:path_)?question\s+([^>]+)\s*\/?>/.exec(text);
  if (matchAttr) {
    const attrs = parseAttributes(matchAttr[1]);
    const questionVal = attrs.question;
    const optionsVal = attrs.options;
    if (questionVal) {
      const options = optionsVal
        ? optionsVal.split(',').map(o => o.trim())
        : ['Yes', 'No'];
      return {
        question: questionVal,
        options
      };
    }
  }
  return null;
}

/**
 * Renders the clean Claude Code-style header (mascot on left, metadata on right)
 */
function printWelcomeBanner(workspaceRoot: string, modelName: string, contextLimit: number, fileCount: number) {
  const cols = process.stdout.columns || 80;

  const mascotLines = [
    '    ' + themePrimary('░░░░░░░░░░░') + '    ',
    ' ' + themePrimary('░░░░') + ' ' + chalk.hex('#707070')('█████████') + ' ' + themePrimary('░░░░'),
    themePrimary('░░░░') + '  ' + chalk.hex('#707070')('██') + ' ' + themeGreen('>') + '   ' + themeGreen('<') + ' ' + chalk.hex('#707070')('██') + '  ' + themePrimary('░░'),
    themePrimary('░░') + '    ' + chalk.hex('#707070')('██') + '   ' + themeGreen('o') + '   ' + chalk.hex('#707070')('██') + '    ',
    '      ' + chalk.hex('#707070')('█████████') + '      '
  ];

  const infoLines = [
    themePrimary.bold('Unit01') + ' ' + themeGreen('v1.0.0'),
    chalk.bold('Model') + '       ' + `${modelName} (${themeGreen(contextLimit.toLocaleString())} ctx)`,
    chalk.bold('Workspace') + '   ' + `${workspaceRoot} (${themeGreen(fileCount)} files)`
  ];

  const stripAnsi = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');

  const maxInfoLen = Math.max(...infoLines.map(l => stripAnsi(l).length));
  const alignedInfo = infoLines.map(line => {
    const len = stripAnsi(line).length;
    return line + ' '.repeat(maxInfoLen - len);
  });

  const contentLines = [
    '',
    ...mascotLines,
    '',
    ...alignedInfo,
    ''
  ];

  console.log(themeBorder('┌' + '─'.repeat(cols - 2) + '┐'));
  for (const line of contentLines) {
    const len = stripAnsi(line).length;
    const leftPad = Math.floor((cols - 2 - len) / 2);
    const rightPad = (cols - 2 - len) - leftPad;
    console.log(themeBorder('│') + ' '.repeat(leftPad) + line + ' '.repeat(rightPad) + themeBorder('│'));
  }
  console.log(themeBorder('└' + '─'.repeat(cols - 2) + '┘'));
}

function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

function processChunk(chunk: string, state: { buffer: string; suppressed: boolean; inCodeBlock?: boolean }): string {
  if (state.suppressed) {
    return '';
  }
  
  if (state.inCodeBlock === undefined) {
    state.inCodeBlock = false;
  }

  let full = state.buffer + chunk;
  let result = '';

  const toolTags = [
    '<run_command',
    '<read_file',
    '<search_code',
    '<write_file',
    '<patch_file',
    '<patch_file_blocks',
    '<list_dir',
    '<git_status',
    '<diagnostics',
    '<move_file',
    '<question',
    '<path_question'
  ];

  while (full.length > 0) {
    if (state.inCodeBlock) {
      // In a code block, suppress all output until we see a closing ```
      const closeIdx = full.indexOf('```');
      if (closeIdx !== -1) {
        state.inCodeBlock = false;
        full = full.substring(closeIdx + 3);
      } else {
        // Keep partial trailing backticks in the buffer
        const match = /`{1,2}$/.exec(full);
        if (match) {
          state.buffer = match[0];
        } else {
          state.buffer = '';
        }
        return result;
      }
    } else {
      let earliestIdx = -1;
      let matchType: 'tool' | 'code' = 'tool';

      for (const tag of toolTags) {
        const idx = full.indexOf(tag);
        if (idx !== -1) {
          if (earliestIdx === -1 || idx < earliestIdx) {
            earliestIdx = idx;
            matchType = 'tool';
          }
        }
      }

      const codeIdx = full.indexOf('```');
      if (codeIdx !== -1) {
        if (earliestIdx === -1 || codeIdx < earliestIdx) {
          earliestIdx = codeIdx;
          matchType = 'code';
        }
      }

      if (earliestIdx !== -1) {
        if (matchType === 'tool') {
          state.suppressed = true;
          state.buffer = '';
          result += full.substring(0, earliestIdx);
          return result;
        } else {
          result += full.substring(0, earliestIdx);
          state.inCodeBlock = true;
          full = full.substring(earliestIdx + 3);
        }
      } else {
        const tagMatch = /<[a-zA-Z_]*$/.exec(full);
        if (tagMatch) {
          const partial = tagMatch[0];
          const isPrefix = toolTags.some(t => t.startsWith(partial));
          if (isPrefix) {
            state.buffer = partial;
            result += full.substring(0, tagMatch.index);
            return result;
          }
        }

        const codeMatch = /`{1,2}$/.exec(full);
        if (codeMatch) {
          state.buffer = codeMatch[0];
          result += full.substring(0, codeMatch.index);
          return result;
        }

        result += full;
        state.buffer = '';
        return result;
      }
    }
  }

  state.buffer = '';
  return result;
}

function truncateAnsiString(str: string, maxLength: number): string {
  const visualLen = stripAnsi(str).length;
  if (visualLen <= maxLength) {
    return str;
  }
  
  const limit = maxLength - 1;
  let currentVisualLen = 0;
  let result = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\u001b') {
      let j = i + 1;
      while (j < str.length && str[j] !== 'm') {
        j++;
      }
      result += str.substring(i, j + 1);
      i = j + 1;
    } else {
      if (currentVisualLen < limit) {
        result += str[i];
        currentVisualLen++;
      }
      i++;
    }
  }
  return result + chalk.dim('…');
}

function getLanguageFromFilename(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
      return 'javascript';
    case '.py':
      return 'python';
    case '.rs':
      return 'rust';
    case '.go':
      return 'go';
    case '.java':
      return 'java';
    case '.c':
    case '.h':
      return 'c';
    case '.cpp':
    case '.hpp':
    case '.cc':
      return 'cpp';
    case '.cs':
      return 'csharp';
    case '.html':
      return 'html';
    case '.css':
      return 'css';
    case '.json':
      return 'json';
    case '.md':
      return 'markdown';
    case '.sh':
    case '.bash':
      return 'bash';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.toml':
      return 'toml';
    case '.sql':
      return 'sql';
    default:
      return ext.slice(1);
  }
}

function diffLines(oldLines: string[], newLines: string[]): { type: 'added' | 'removed' | 'unchanged'; text: string }[] {
  const M = oldLines.length;
  const N = newLines.length;
  const dp: number[][] = Array.from({ length: M + 1 }, () => Array(N + 1).fill(0));
  for (let i = 1; i <= M; i++) {
    for (let j = 1; j <= N; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  const diff: { type: 'added' | 'removed' | 'unchanged'; text: string }[] = [];
  let i = M, j = N;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      diff.unshift({ type: 'unchanged', text: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diff.unshift({ type: 'added', text: newLines[j - 1] });
      j--;
    } else {
      diff.unshift({ type: 'removed', text: oldLines[i - 1] });
      i--;
    }
  }
  return diff;
}

function renderSideBySideDiff(original: string, modified: string, language: string, filePath: string) {
  const borderCol = themeBorder;
  const cols = Math.max(process.stdout.columns || 80, 80);
  const sideWidth = Math.floor((cols - 9) / 2);
  
  const oldRaw = original.split('\n');
  const newRaw = modified.split('\n');
  
  let oldHighlighted: string[] = [];
  let newHighlighted: string[] = [];
  
  try {
    oldHighlighted = highlightCli(original, { language }).split('\n');
    newHighlighted = highlightCli(modified, { language }).split('\n');
  } catch (e) {
    oldHighlighted = oldRaw.map(l => chalk.yellow(l));
    newHighlighted = newRaw.map(l => chalk.yellow(l));
  }
  
  const diff = diffLines(oldRaw, newRaw);
  const rows: {
    left: { text: string; type: 'unchanged' | 'removed' | 'empty'; rawLen: number };
    right: { text: string; type: 'unchanged' | 'added' | 'empty'; rawLen: number };
  }[] = [];
  let oldIdx = 0, newIdx = 0, idx = 0;
  
  while (idx < diff.length) {
    if (diff[idx].type === 'unchanged') {
      rows.push({
        left: { text: oldHighlighted[oldIdx] || '', type: 'unchanged', rawLen: (oldRaw[oldIdx] || '').length },
        right: { text: newHighlighted[newIdx] || '', type: 'unchanged', rawLen: (newRaw[newIdx] || '').length }
      });
      oldIdx++;
      newIdx++;
      idx++;
    } else {
      const removed: { text: string; rawLen: number }[] = [];
      const added: { text: string; rawLen: number }[] = [];
      while (idx < diff.length && diff[idx].type !== 'unchanged') {
        if (diff[idx].type === 'removed') {
          removed.push({ text: oldHighlighted[oldIdx] || '', rawLen: (oldRaw[oldIdx] || '').length });
          oldIdx++;
        } else {
          added.push({ text: newHighlighted[newIdx] || '', rawLen: (newRaw[newIdx] || '').length });
          newIdx++;
        }
        idx++;
      }
      const maxLen = Math.max(removed.length, added.length);
      for (let k = 0; k < maxLen; k++) {
        rows.push({
          left: k < removed.length ? { text: removed[k].text, type: 'removed', rawLen: removed[k].rawLen } : { text: '', type: 'empty', rawLen: 0 },
          right: k < added.length ? { text: added[k].text, type: 'added', rawLen: added[k].rawLen } : { text: '', type: 'empty', rawLen: 0 }
        });
      }
    }
  }
  
  const bgRemoved = '\u001b[48;2;80;30;30m'; // #501E1E (slightly brighter red)
  const bgAdded = '\u001b[48;2;30;80;30m'; // #1E501E (slightly brighter green)
  const bgUnchanged = '\u001b[48;2;25;25;25m'; // #191919 (dark gray)
  const ansiReset = '\u001b[0m';
  
  console.log('\n' + borderCol('┌' + '─'.repeat(sideWidth + 2) + '┬' + '─'.repeat(sideWidth + 2) + '┐'));
  const leftHeader = `Original: ${path.basename(filePath)}`.substring(0, sideWidth);
  const rightHeader = `Modified: ${path.basename(filePath)}`.substring(0, sideWidth);
  console.log(borderCol('│ ') + chalk.bold.gray(leftHeader.padEnd(sideWidth)) + borderCol(' │ ') + chalk.bold.green(rightHeader.padEnd(sideWidth)) + borderCol(' │'));
  console.log(borderCol('├' + '─'.repeat(sideWidth + 2) + '┼' + '─'.repeat(sideWidth + 2) + '┤'));
  
  let leftLineNum = 1;
  let rightLineNum = 1;
  
  for (const row of rows) {
    let leftStyled: string, rightStyled: string;
    
    // Left Column (Original/Removed)
    if (row.left.type === 'empty') {
      leftStyled = bgUnchanged + '    ' + chalk.gray(' │ ') + ' '.repeat(sideWidth - 8) + ansiReset;
    } else {
      const bg = row.left.type === 'removed' ? bgRemoved : bgUnchanged;
      const prefix = row.left.type === 'removed' ? chalk.red('- ') : '  ';
      const numStr = leftLineNum.toString().padStart(4, ' ');
      leftLineNum++;
      
      const maxTextWidth = sideWidth - 8;
      const expanded = row.left.text.replaceAll('\t', '    ');
      const truncated = truncateAnsiString(expanded, maxTextWidth);
      const visualLen = stripAnsi(truncated).length;
      leftStyled = bg + chalk.gray(numStr) + chalk.gray(' │ ') + prefix + truncated.replaceAll(ansiReset, ansiReset + bg) + ' '.repeat(Math.max(maxTextWidth - visualLen, 0)) + ansiReset;
    }
    
    // Right Column (Modified/Added)
    if (row.right.type === 'empty') {
      rightStyled = bgUnchanged + '    ' + chalk.gray(' │ ') + ' '.repeat(sideWidth - 8) + ansiReset;
    } else {
      const bg = row.right.type === 'added' ? bgAdded : bgUnchanged;
      const prefix = row.right.type === 'added' ? chalk.green('+ ') : '  ';
      const numStr = rightLineNum.toString().padStart(4, ' ');
      rightLineNum++;
      
      const maxTextWidth = sideWidth - 8;
      const expanded = row.right.text.replaceAll('\t', '    ');
      const truncated = truncateAnsiString(expanded, maxTextWidth);
      const visualLen = stripAnsi(truncated).length;
      rightStyled = bg + chalk.gray(numStr) + chalk.gray(' │ ') + prefix + truncated.replaceAll(ansiReset, ansiReset + bg) + ' '.repeat(Math.max(maxTextWidth - visualLen, 0)) + ansiReset;
    }
    
    console.log(borderCol('│ ') + leftStyled + borderCol(' │ ') + rightStyled + borderCol(' │'));
  }
  console.log(borderCol('└' + '─'.repeat(sideWidth + 2) + '┴' + '─'.repeat(sideWidth + 2) + '┘') + '\n');
}

function renderNewFileBlock(content: string, language: string, filePath: string) {
  const borderCol = themeBorder;
  const cols = Math.max(process.stdout.columns || 80, 80);
  const contentWidth = cols - 6;
  
  const rawLines = content.split('\n');
  let highlightedLines: string[] = [];
  try {
    highlightedLines = highlightCli(content, { language }).split('\n');
  } catch (e) {
    highlightedLines = rawLines.map(l => chalk.yellow(l));
  }
  
  const bgAdded = '\u001b[48;2;20;60;20m'; // #143C14
  const ansiReset = '\u001b[0m';
  
  console.log('\n' + borderCol('┌' + '─'.repeat(contentWidth + 2) + '┐'));
  const header = `New File: ${path.basename(filePath)}`.substring(0, contentWidth);
  console.log(borderCol('│ ') + chalk.bold.green(header.padEnd(contentWidth)) + borderCol(' │'));
  console.log(borderCol('├' + '─'.repeat(contentWidth + 2) + '┤'));
  
  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = (i + 1).toString().padStart(4, ' ');
    const maxTextWidth = contentWidth - 8;
    const expanded = (highlightedLines[i] || '').replaceAll('\t', '    ');
    const truncated = truncateAnsiString(expanded, maxTextWidth);
    const visualLen = stripAnsi(truncated).length;
    const clean = truncated.replaceAll(ansiReset, ansiReset + bgAdded);
    const pad = ' '.repeat(Math.max(maxTextWidth - visualLen, 0));
    
    const styled = bgAdded + chalk.gray(lineNum) + chalk.gray(' │ ') + chalk.green('+ ') + clean + pad + ansiReset;
    console.log(borderCol('│ ') + styled + borderCol(' │'));
  }
  console.log(borderCol('└' + '─'.repeat(contentWidth + 2) + '┘') + '\n');
}


async function handleToolCalls(
  text: string,
  sandbox: DirectiveSandbox,
  indexer: DirectiveIndexer,
  rl: readline.Interface
): Promise<{ toolRun: boolean; nextPrompt: string; consoleOutput: string }> {
  // Parse and validate all XML/HTML tags
  const openTagRegex = /<([a-zA-Z_][a-zA-Z0-9_\-]*)([^>]*)>/g;
  let match;
  while ((match = openTagRegex.exec(text))) {
    const tagName = match[1];
    const attributesStr = match[2];
    
    const isTool = tagName === 'run_command' || tagName === 'read_file' || tagName === 'write_file' || tagName === 'search_code' ||
                   tagName === 'sandbox_exec' || HALLUCINATED_TAGS.has(tagName.toLowerCase()) || tagName.endsWith('_file') || tagName.endsWith('_dir') || tagName === 'question' || tagName === 'path_question';
    
    if (isTool) {
      const errorMsg = validateToolCall(tagName, attributesStr);
      if (errorMsg) {
        console.log(`\n  ${chalk.red('✗')} tool call ${chalk.yellow(`<${tagName}>`)} (blocked: invalid/wrong arguments)`);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${errorMsg}\n</tool_output>`,
          consoleOutput: `\n[Tool call blocked: <${tagName}>]`
        };
      }
    }
  }

  const runCmd = parseRunCommand(text);
  if (runCmd !== null) {
    const cmd = runCmd;
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themePrimary('run')} ${cmd} ...`);
    const output = await sandbox.runCommand(cmd);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    if (output.startsWith('[DIRECTIVE AI]')) {
      console.log(`  ${chalk.red('✗')} ${themePrimary('run')} ${cmd} (blocked)`);
      console.log(chalk.red(`\n⚠️  [Sandbox Guard] ${output}`));
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Blocked: ${cmd}]`
      };
    }

    if (output.startsWith('{') && output.includes('FILE_NOT_WRITTEN')) {
      console.log(`  ${chalk.red('✗')} ${themePrimary('run')} ${cmd} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${output}\n</tool_output>`,
        consoleOutput: `\n[Failed: ${cmd}]`
      };
    }

    if (output.startsWith('[Command failed with exit code')) {
      console.log(`  ${chalk.red('✗')} ${themePrimary('run')} ${cmd} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${output.trim()}\n</tool_output>`,
        consoleOutput: `\n[Failed: ${cmd}]`
      };
    }

    console.log(`  ${themeGreen('✓')} ${themePrimary('run')} ${cmd} (completed)`);
    const outputResult = output.trim() || 'Command executed successfully with no output.';
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${outputResult}\n</tool_output>`,
      consoleOutput: `\n[Sandbox output executed: ${cmd}]`
    };
  }

  const writeResult = parseWriteFile(text);
  if (writeResult) {
    const filePath = writeResult.filePath;
    const content = writeResult.content;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    
    if (!sandbox.isPathWriteAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Write blocked (not allowed): ${filePath}]`
      };
    }

    const fileExists = fs.existsSync(absPath);
    const original = fileExists ? fs.readFileSync(absPath, 'utf-8') : null;
    
    if (original !== null && original.trim() === content.trim()) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nNo changes detected. The proposed content for ${filePath} matches the existing content.\n</tool_output>`,
        consoleOutput: `\n[No changes detected: ${filePath}]`
      };
    }
    
    lastWrittenFile = {
      filePath,
      original,
      content
    };
    
    const lineCount = content.split('\n').length;
    const actionStr = fileExists ? 'modify' : 'create';
    console.log(`\n  ${themeGreen(actionStr)} Proposed: ${filePath} (${lineCount} lines)`);
    
    const userConfirmed = await new Promise<boolean>((resolve) => {
      rl.question(`? Confirm changes? [y/N/p(review)]: `, (answer) => {
        const normalized = answer.trim().toLowerCase();
        if (normalized === 'y' || normalized === 'yes') {
          resolve(true);
        } else if (normalized === 'p' || normalized === 'preview' || normalized === 'v') {
          if (fileExists && original !== null) {
            renderSideBySideDiff(original, content, getLanguageFromFilename(filePath), filePath);
          } else {
            renderNewFileBlock(content, getLanguageFromFilename(filePath), filePath);
          }
          rl.question(`? Confirm writing changes to ${filePath}? [y/N]: `, (secondAnswer) => {
            const normalizedSecond = secondAnswer.trim().toLowerCase();
            resolve(normalizedSecond === 'y' || normalizedSecond === 'yes');
          });
        } else {
          resolve(false);
        }
      });
    });
    
    if (!userConfirmed) {
      console.log(`  ${chalk.red('✗')} ${themeGreen('write')} rejected by user`);
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Write rejected by user: ${filePath}]`
      };
    }
    
    process.stdout.write(`  ${themeOrange('⠋')} ${themeGreen('write')} ${filePath} ...`);
    try {
      indexer.backupBeforeWrite(absPath);
      
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf-8');
      
      // Clear sandbox loop history since file modification changes workspace state
      sandbox.clearLoopHistory();
      
      // Record written file for sandbox write-before-run enforcement
      sandbox.recordWrittenFile(absPath);
      
      // Re-index
      try {
        const stat = fs.statSync(absPath);
        indexer['processFileOnStartup'](absPath, stat);
        indexer['currentRepoMap'] = buildRepoMap(indexer['db']);
      } catch (e) {}
      
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} ${themeGreen('write')} ${filePath} (completed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully written and indexed at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File written: ${filePath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${chalk.red('✗')} ${themeGreen('write')} ${filePath} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError writing file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File write failed: ${filePath}]`
      };
    }
  }

  const readPath = parseReadFile(text);
  if (readPath !== null) {
    const filePath = readPath;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    
    if (!sandbox.isPathAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Read blocked (not allowed): ${filePath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('read')} ${filePath} ...`);
    
    let content = '';
    let success = false;
    try {
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          content = `Error: ${filePath} is a directory. Use run_command with shell commands like 'ls' or 'find' to inspect its contents.`;
        } else {
          content = fs.readFileSync(absPath, 'utf-8');
          success = true;
        }
      } else {
        content = `Error: File not found at ${filePath}`;
      }
    } catch (err: any) {
      content = `Error: ${err.message}`;
    }
    
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    if (success) {
      console.log(`  ${themeGreen('✓')} ${themeGreen('read')} ${filePath} (completed)`);
    } else {
      console.log(`  ${chalk.red('✗')} ${themeGreen('read')} ${filePath} (failed)`);
    }
    
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nFile content of ${filePath}:\n${content}\n</tool_output>`,
      consoleOutput: `\n[File read: ${filePath}]`
    };
  }

  const searchQuery = parseSearchCode(text);
  if (searchQuery !== null) {
    const query = searchQuery.trim();
    if (!query) {
      console.log(`\n  ${chalk.red('✗')} ${themeGreen('search')} complete: blocked (empty query)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: Search query cannot be empty. Please provide specific keywords to search the codebase.\n</tool_output>`,
        consoleOutput: `\n[Search blocked: empty query]`
      };
    }
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('search')} index for "${query}" ...`);
    const results = indexer.search(query);
    
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`  ${themeGreen('✓')} ${themeGreen('search')} complete: Found ${results.length} matches.`);
    
    const formatted = results.slice(0, 5).map(r => 
      `- ${r.relpath} (line ${r.start_line}-${r.end_line}, type ${r.chunk_type}):\n${r.content}`
    ).join('\n\n');
    
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nSearch results for "${query}":\n${formatted || 'No matches found'}\n</tool_output>`,
      consoleOutput: `\n[Search executed: "${query}"]`
    };
  }

  const patchResult = parsePatchFile(text);
  if (patchResult) {
    const { filePath, search, replace } = patchResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);

    if (!sandbox.isPathWriteAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Patch blocked (not allowed): ${filePath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('patch')} ${filePath} ...`);

    try {
      if (!fs.existsSync(absPath)) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  ${chalk.red('✗')} ${themeGreen('patch')} ${filePath} (failed)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: "Search string not found in file. Verify the text matches exactly including whitespace and indentation.",
          code: "PATCH_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch failed: File not found: ${filePath}]`
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      const index = content.indexOf(search);
      if (index === -1) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  ${chalk.red('✗')} ${themeGreen('patch')} ${filePath} (failed)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: "Search string not found in file. Verify the text matches exactly including whitespace and indentation.",
          code: "PATCH_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch failed: Search string not found in ${filePath}]`
        };
      }

      indexer.backupBeforeWrite(absPath);

      const updated = content.slice(0, index) + replace + content.slice(index + search.length);
      fs.writeFileSync(absPath, updated, 'utf-8');

      sandbox.clearLoopHistory();
      sandbox.recordWrittenFile(absPath);

      try {
        const stat = fs.statSync(absPath);
        indexer['processFileOnStartup'](absPath, stat);
        indexer['currentRepoMap'] = buildRepoMap(indexer['db']);
      } catch (e) {}

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} ${themeGreen('patch')} ${filePath} (completed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully patched at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File patched: ${filePath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${chalk.red('✗')} ${themeGreen('patch')} ${filePath} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError patching file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File patch failed: ${filePath}]`
      };
    }
  }

  const patchBlocksResult = parsePatchFileBlocks(text);
  if (patchBlocksResult) {
    const { filePath, diff } = patchBlocksResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);

    if (!sandbox.isPathWriteAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Patch blocks blocked (not allowed): ${filePath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('patch_blocks')} ${filePath} ...`);

    try {
      if (!fs.existsSync(absPath)) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  ${chalk.red('✗')} ${themeGreen('patch_blocks')} ${filePath} (failed)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: `File not found at ${filePath}`,
          code: "PATCH_FILE_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch blocks failed: File not found: ${filePath}]`
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      
      let updated: string;
      try {
        updated = applySearchReplaceBlocks(content, diff);
      } catch (err: any) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  ${chalk.red('✗')} ${themeGreen('patch_blocks')} ${filePath} (failed)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: err.message || String(err),
          code: err.code || "PATCH_BLOCK_FAILED",
          blockIndex: err.blockIndex,
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch blocks failed: ${err.message}]`
        };
      }

      indexer.backupBeforeWrite(absPath);

      fs.writeFileSync(absPath, updated, 'utf-8');

      sandbox.clearLoopHistory();
      sandbox.recordWrittenFile(absPath);

      try {
        const stat = fs.statSync(absPath);
        indexer['processFileOnStartup'](absPath, stat);
        indexer['currentRepoMap'] = buildRepoMap(indexer['db']);
      } catch (e) {}

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} ${themeGreen('patch_blocks')} ${filePath} (completed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully patched using blocks at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File patched with blocks: ${filePath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${chalk.red('✗')} ${themeGreen('patch_blocks')} ${filePath} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError patching file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File patch blocks failed: ${filePath}]`
      };
    }
  }

  const listDirResult = parseListDir(text);
  if (listDirResult) {
    const { pathVal, recursive } = listDirResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], pathVal);

    if (!sandbox.isPathAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[List dir blocked (not allowed): ${pathVal}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('list_dir')} ${pathVal} ...`);

    try {
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  ${chalk.red('✗')} ${themeGreen('list_dir')} ${pathVal} (failed)`);
        const errObj = {
          error: `Directory not found at ${pathVal}`,
          code: "DIRECTORY_NOT_FOUND",
          path: pathVal
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[List dir failed: Directory not found: ${pathVal}]`
        };
      }

      const result = listDirectory(absPath, sandbox['workspaceRoot'], recursive);

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} ${themeGreen('list_dir')} ${pathVal} (completed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Directory listed: ${pathVal}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${chalk.red('✗')} ${themeGreen('list_dir')} ${pathVal} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError listing directory: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Directory list failed: ${pathVal}]`
      };
    }
  }

  if (parseGitStatus(text)) {
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('git_status')} ...`);

    try {
      let isGit = false;
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: sandbox['workspaceRoot'], stdio: 'ignore' });
        isGit = true;
      } catch (e) {}

      if (!isGit) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  ${chalk.red('✗')} ${themeGreen('git_status')} (failed)`);
        const errObj = {
          error: "Not a git repository",
          code: "NOT_GIT_REPO"
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Git status failed: Not a git repository]`
        };
      }

      const branch = execSync('git branch --show-current', { cwd: sandbox['workspaceRoot'] }).toString().trim();
      const statusText = execSync('git status --porcelain', { cwd: sandbox['workspaceRoot'] }).toString().trim();

      const lines = statusText ? statusText.split('\n') : [];
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const file = line.slice(3).replace(/^["']|["']$/g, '');

        if (x === '?' && y === '?') {
          untracked.push(file);
        } else {
          if (x !== ' ' && x !== '?') {
            staged.push(file);
          }
          if (y !== ' ' && y !== '?') {
            unstaged.push(file);
          }
        }
      }

      let ahead = 0;
      let behind = 0;
      try {
        const revList = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd: sandbox['workspaceRoot'], stdio: 'pipe' }).toString().trim();
        const parts = revList.split(/\s+/);
        if (parts.length === 2) {
          ahead = parseInt(parts[0], 10) || 0;
          behind = parseInt(parts[1], 10) || 0;
        }
      } catch (e) {}

      const result = {
        branch,
        staged,
        unstaged,
        untracked,
        ahead,
        behind
      };

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} ${themeGreen('git_status')} (completed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Git status completed]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${chalk.red('✗')} ${themeGreen('git_status')} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError running git status: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Git status failed: ${err.message}]`
      };
    }
  }

  const diagResult = parseDiagnosticsTag(text);
  if (diagResult !== null) {
    let commandToRun = diagResult.command;
    const workspaceRoot = sandbox['workspaceRoot'];

    if (!commandToRun) {
      if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
        let hasLintScript = false;
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
          if (pkg.scripts && pkg.scripts.lint) {
            hasLintScript = true;
          }
        } catch (e) {}
        commandToRun = hasLintScript ? 'npm run lint' : 'npm run build';
      } else if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
        commandToRun = 'cargo check';
      } else if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
        commandToRun = 'go build ./...';
      } else if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) || fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
        commandToRun = 'python -m py_compile';
      }
    }

    if (!commandToRun) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          passed: true,
          errors: [],
          warnings: [],
          raw: "No standard project configuration (package.json, Cargo.toml, go.mod, pyproject.toml, setup.py) detected to run diagnostics."
        }, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Diagnostics skipped: No configuration]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('diagnostics')} (running "${commandToRun}") ...`);

    try {
      const rawOutput = await sandbox.runCommand(commandToRun);
      
      const parsed = parseDiagnostics(rawOutput);
      const result = {
        passed: parsed.passed,
        errors: parsed.errors,
        warnings: parsed.warnings,
        raw: rawOutput
      };

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} ${themeGreen('diagnostics')} (completed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Diagnostics completed: "${commandToRun}"]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${chalk.red('✗')} ${themeGreen('diagnostics')} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError running diagnostics: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Diagnostics failed]`
      };
    }
  }

  const moveResult = parseMoveFile(text);
  if (moveResult !== null) {
    const { sourcePath, destinationPath } = moveResult;
    const absSource = path.resolve(sandbox['workspaceRoot'], sourcePath);
    const absDest = path.resolve(sandbox['workspaceRoot'], destinationPath);

    if (!sandbox.isPathWriteAllowed(absSource)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absSource} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absSource
        })}\n</tool_output>`,
        consoleOutput: `\n[Move blocked (source not allowed): ${sourcePath}]`
      };
    }

    if (!sandbox.isPathWriteAllowed(absDest)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absDest} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absDest
        })}\n</tool_output>`,
        consoleOutput: `\n[Move blocked (destination not allowed): ${destinationPath}]`
      };
    }

    if (!fs.existsSync(absSource)) {
      console.log(`\n  ${chalk.red('✗')} ${themeGreen('move')} ${sourcePath} (failed: not found)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Source file not found at ${sourcePath}`,
          code: "MOVE_SOURCE_NOT_FOUND",
          sourcePath
        })}\n</tool_output>`,
        consoleOutput: `\n[Move failed: Source not found: ${sourcePath}]`
      };
    }

    if (fs.existsSync(absDest)) {
      console.log(`\n  ${chalk.red('✗')} ${themeGreen('move')} -> ${destinationPath} (failed: destination already exists)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Destination path already exists at ${destinationPath}. Move aborted to prevent overwrite.`,
          code: "MOVE_DESTINATION_EXISTS",
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Move failed: Destination exists: ${destinationPath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeGreen('move')} ${sourcePath} to ${destinationPath} ...`);

    try {
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.renameSync(absSource, absDest);

      indexer.renameFile(absSource, absDest);
      sandbox.recordWrittenFile(absDest);
      sandbox.clearLoopHistory();

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} ${themeGreen('move')} ${sourcePath} to ${destinationPath} (completed)`);
      
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          success: true,
          message: `File successfully moved/renamed from ${sourcePath} to ${destinationPath}`,
          sourcePath,
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[File moved: ${sourcePath} -> ${destinationPath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${chalk.red('✗')} ${themeGreen('move')} ${sourcePath} -> ${destinationPath} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Failed to move/rename file: ${err.message}`,
          code: "MOVE_FAILED",
          sourcePath,
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[File move failed: ${sourcePath} -> ${destinationPath}]`
      };
    }
  }

  const questionResult = parseQuestion(text);
  if (questionResult !== null) {
    const { question, options } = questionResult;
    
    let chosenIdx = 0;
    if (isNonInteractive || typeof process.stdin.setRawMode !== 'function') {
      console.log(`\n${themePrimary.bold(question)}`);
      options.forEach((opt, idx) => console.log(`  ${idx + 1}) ${opt}`));
      const answer = await new Promise<string>((resolve) => {
        rl.question(`Select an option (1-${options.length}): `, (input) => {
          resolve(input.trim());
        });
      });
      const num = parseInt(answer, 10);
      chosenIdx = (!isNaN(num) && num >= 1 && num <= options.length) ? num - 1 : 0;
    } else {
      chosenIdx = await interactiveSelect(question, options);
    }

    const choice = options[chosenIdx];
    const extractedPath = extractPathFromQuestion(question);

    if (choice === 'Allow read-write') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!activeAllowedPaths.some(ap => ap.path === absPath && ap.mode === 'rw')) {
          activeAllowedPaths = activeAllowedPaths.filter(ap => ap.path !== absPath);
          activeAllowedPaths.push({ path: absPath, mode: 'rw' });
        }
        sandbox.updateAllowedPaths(activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'rw',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (rw): ${absPath}]`
        };
      }
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          granted: true,
          message: 'Access granted, but no path could be extracted from the question.'
        })}\n</tool_output>`,
        consoleOutput: `\n[Permission granted: no path extracted]`
      };
    }

    if (choice === 'Allow read-only') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!activeAllowedPaths.some(ap => ap.path === absPath)) {
          activeAllowedPaths.push({ path: absPath, mode: 'ro' });
        }
        sandbox.updateAllowedPaths(activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'ro',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (ro): ${absPath}]`
        };
      }
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          granted: true,
          message: 'Access granted, but no path could be extracted from the question.'
        })}\n</tool_output>`,
        consoleOutput: `\n[Permission granted: no path extracted]`
      };
    }

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify({
        granted: false,
        path: extractedPath ? path.resolve(extractedPath.startsWith('~/') || extractedPath === '~' ? (os.homedir() + extractedPath.slice(1)) : extractedPath) : undefined
      })}\n</tool_output>`,
      consoleOutput: `\n[Permission denied]`
    };
  }

  return { toolRun: false, nextPrompt: '', consoleOutput: '' };
}

interface RuthenConfig {
  allowed_paths?: AllowedPath[];
  compact_threshold?: number;
}

interface SelectableModel {
  name: string;
  displayName: string;
  isLocalGguf: boolean;
  ggufPath?: string;
  parameterSize: string;
}

function loadConfig(workspaceRoot: string): RuthenConfig {
  const configPath = path.join(workspaceRoot, 'ruthen.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return data || {};
    } catch (e: any) {
      console.warn(chalk.yellow(`⚠ Warning: Failed to parse ruthen.json config: ${e.message}`));
    }
  }
  return {};
}

async function startCli() {
  const workspaceRoot = path.resolve(__dirname, '..');

  // Parse command line arguments
  const args = process.argv.slice(2);
  let activeModelArg: string | null = null;
  let nonInteractivePrompt: string | null = null;
  const cliAllowedPaths: AllowedPath[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && i + 1 < args.length) {
      activeModelArg = args[i + 1];
      i++;
    } else if (args[i] === '-p' && i + 1 < args.length) {
      nonInteractivePrompt = args[i + 1];
      i++;
    } else if (args[i] === '--allow' && i + 1 < args.length) {
      cliAllowedPaths.push({ path: args[i + 1], mode: 'rw' });
      i++;
    } else if (args[i] === '--allow-read' && i + 1 < args.length) {
      cliAllowedPaths.push({ path: args[i + 1], mode: 'ro' });
      i++;
    }
  }

  // 1. Discover local Ollama models and models directory GGUF files
  const ollamaModels = await ollama.listModels();
  const modelsDir = path.join(workspaceRoot, 'models');
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }

  const localFiles = fs.readdirSync(modelsDir).filter(file => file.endsWith('.gguf'));
  const models: SelectableModel[] = [];

  for (const m of ollamaModels) {
    models.push({
      name: m.name,
      displayName: m.name,
      isLocalGguf: m.name.startsWith('local-'),
      parameterSize: m.details.parameter_size || 'unknown'
    });
  }

  for (const file of localFiles) {
    const cleanName = 'local-' + file.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/\.gguf$/, '');
    const exists = models.some(m => m.name === cleanName);
    if (!exists) {
      const stats = fs.statSync(path.join(modelsDir, file));
      const sizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
      models.push({
        name: cleanName,
        displayName: `${file} (unregistered GGUF)`,
        isLocalGguf: true,
        ggufPath: path.join(modelsDir, file),
        parameterSize: sizeGB
      });
    } else {
      const match = models.find(m => m.name === cleanName);
      if (match) {
        match.displayName = `${file} (GGUF)`;
      }
    }
  }

  if (models.length === 0) {
    console.error(chalk.red('\n[Error] No models detected. Drop a .gguf file into the models/ directory or run a model via Ollama (e.g. `ollama run qwen2.5-coder`).'));
    process.exit(1);
  }

  let activeModel = models[0].name;
  let initialGgufPath = models[0].ggufPath;

  if (activeModelArg) {
    const matchIndex = models.findIndex(m => m.name === activeModelArg);
    if (matchIndex !== -1) {
      activeModel = models[matchIndex].name;
      initialGgufPath = models[matchIndex].ggufPath;
    } else {
      console.warn(chalk.yellow(`⚠ Warning: Specified model "${activeModelArg}" not found in local library. Using default: ${activeModel}`));
    }
  }

  const activateModel = async (target: SelectableModel) => {
    if (target.ggufPath) {
      const fileBase = path.basename(target.ggufPath);
      process.stdout.write(`\n  ${themeOrange('⠋')} Registering local GGUF file in Ollama: ${fileBase} ...`);
      try {
        await ollama.createModel(target.name, target.ggufPath, (status) => {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          process.stdout.write(`  ${themeOrange('⠋')} Registering model (${status}) ...`);
        });
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`  ${themeGreen('✓')} Registered successfully.`);
        delete target.ggufPath;
        target.displayName = `${fileBase} (GGUF)`;
      } catch (err: any) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(chalk.red(`  ✗ Failed to register model: ${err.message}`));
        return false;
      }
    }
    activeModel = target.name;
    contextLimit = await ollama.getContextLimit(activeModel);
    console.log(chalk.green(`Switched to active model: ${activeModel}`));
    return true;
  };

  if (initialGgufPath) {
    console.log(`\n  ${themeOrange('⠋')} Registering local GGUF file in Ollama: ${path.basename(initialGgufPath)} ...`);
    try {
      await ollama.createModel(activeModel, initialGgufPath, (status) => {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(`  ${themeOrange('⠋')} Registering model (${status}) ...`);
      });
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.log(`  ${themeGreen('✓')} Registered successfully.`);
      
      const match = models.find(m => m.name === activeModel);
      if (match) {
        delete match.ggufPath;
        match.displayName = `${path.basename(initialGgufPath)} (GGUF)`;
      }
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      console.error(chalk.red(`\n[Error] Failed to register GGUF model: ${err.message}`));
      process.exit(1);
    }
  }

  let contextLimit = await ollama.getContextLimit(activeModel);
  let thinkingEnabled = true;

  // Load config and merge allowed paths
  const config = loadConfig(workspaceRoot);
  const rawAllowed = [...(config.allowed_paths || []), ...cliAllowedPaths];
  const resolvedAllowedPaths: AllowedPath[] = [];
  for (const item of rawAllowed) {
    let resolvedPath = item.path;
    if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
      resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
    }
    resolvedAllowedPaths.push({
      path: path.resolve(resolvedPath),
      mode: item.mode
    });
  }
  activeAllowedPaths = resolvedAllowedPaths;

  // Check home directory warnings
  const homeDir = os.homedir();
  for (const entry of activeAllowedPaths) {
    if (entry.mode === 'rw') {
      const absPath = path.resolve(entry.path);
      const rel = path.relative(absPath, homeDir);
      if (!rel.startsWith('..')) {
        console.warn(chalk.yellow(`⚠ Warning: Allowed path "${entry.path}" is the home directory or a parent of the home directory with read-write permissions.`));
      }
    }
  }

  // 2. Initialize Indexer and Sandbox
  const indexer = new DirectiveIndexer(workspaceRoot);
  await indexer.initialize();

  const sandbox = new DirectiveSandbox(workspaceRoot, activeAllowedPaths);
  await sandbox.initialize();

  const gitBranch = getGitBranch(workspaceRoot);
  const fileCount = indexer['db'].getAllFiles().length;

  if (nonInteractivePrompt) {
    isNonInteractive = true;
  } else {
    // 3. Render Welcome Banner
    printWelcomeBanner(workspaceRoot, activeModel, contextLimit, fileCount);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const conversationHistory: { role: string; content: string }[] = [];
  const sessionStartTime = Date.now();
  let lastInputTokens = 0;
  let pendingCompaction = false;
  let currentOperation: string | null = null;

  let compactThreshold = 0.8;
  if (config.compact_threshold !== undefined) {
    if (typeof config.compact_threshold !== 'number' || config.compact_threshold < 0.5 || config.compact_threshold > 0.95) {
      console.error(chalk.red(`\n[Config Error] "compact_threshold" must be a number between 0.5 and 0.95. Received: ${config.compact_threshold}`));
      process.exit(1);
    }
    compactThreshold = config.compact_threshold;
  }

  const runCompaction = async (isAuto: boolean): Promise<boolean> => {
    if (conversationHistory.length < 3) {
      if (!isAuto) {
        console.log(chalk.yellow('Nothing to compact yet — session has fewer than 3 messages.'));
      }
      return false;
    }

    const activeRepoMap = indexer.getRepoMap();
    const activeChanges = indexer.getRecentChanges();
    const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
    const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
    const pct = Math.round((totalTokens / contextLimit) * 100);

    if (!isAuto) {
      console.log(chalk.gray(`Compacting context (currently ${totalTokens.toLocaleString()} tokens, ${pct}% of limit)...`));
    }

    // Determine history to summarize
    let messagesToSummarize = [...conversationHistory];
    const currentPct = totalTokens / contextLimit;
    if (currentPct > 0.60) {
      const countToKeep = Math.max(1, Math.floor(conversationHistory.length * 0.60));
      messagesToSummarize = conversationHistory.slice(-countToKeep);
    }

    const summaryPrompt = `Summarise this conversation into a concise but complete technical brief. Include:
- The original goal and current task state
- Every file that was read, created, or modified (exact paths)
- Every command that was run and its outcome
- Every decision made and why
- Any errors encountered and how they were resolved
- Exactly what has been done and what still remains

Be specific. Use exact file names, function names, and line numbers where relevant.`;

    const summarisationPayload = [
      ...messagesToSummarize,
      {
        role: 'user',
        content: summaryPrompt
      }
    ];

    const abortController = new AbortController();
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const hasRawMode = typeof stdin.setRawMode === 'function';

    const onKeypress = (str: any, key: any) => {
      if (key) {
        if (key.name === 'escape') {
          abortController.abort();
        } else if (key.ctrl && key.name === 'c') {
          if (hasRawMode) {
            try {
              stdin.removeListener('keypress', onKeypress);
              stdin.setRawMode(wasRaw);
            } catch (_) {}
          }
          process.exit(130);
        }
      }
    };

    if (hasRawMode) {
      try {
        stdin.setRawMode(true);
        stdin.resume();
        readline.emitKeypressEvents(stdin);
        stdin.on('keypress', onKeypress);
      } catch (_) {}
    }

    try {
      try {
        const chatResult = await ollama.chatStream(
          activeModel,
          summarisationPayload,
          contextLimit,
          () => {}, // silent streaming
          abortController.signal
        );

        const summaryContent = chatResult.content.trim();
        if (!summaryContent) {
          throw new Error('Model returned an empty summary');
        }

        // Replace history
        conversationHistory.length = 0;
        conversationHistory.push({
          role: 'system',
          content: `[COMPACTED CONTEXT — conversation summarised at ${new Date().toISOString()}]\n\n${summaryContent}`
        });

        const newHistoryLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const newTotal = systemPromptLength + newHistoryLength;
        const saved = totalTokens - newTotal;
        lastInputTokens = newTotal;

        if (isAuto) {
          console.log(chalk.yellow(`⚡ Context auto-compacted (was ${pct}% full). Saved ${saved.toLocaleString()} tokens.`));
        } else {
          console.log(chalk.green(`✓ Context compacted: ${totalTokens.toLocaleString()} → ${newTotal.toLocaleString()} tokens (saved ${saved.toLocaleString()})`));
        }
        return true;
      } finally {
        if (hasRawMode) {
          try {
            stdin.removeListener('keypress', onKeypress);
            stdin.setRawMode(wasRaw);
          } catch (_) {}
        }
      }
    } catch (err: any) {
      const isAbort = err.name === 'AbortError' || 
                      err.message?.includes('aborted') || 
                      err.message?.includes('Abort');
      if (isAbort) {
        console.warn(chalk.yellow(`\n⚠ Warning: Compaction aborted by user. Context not compacted.`));
      } else {
        console.warn(chalk.yellow(`⚠ Warning: Compaction failed during LLM summarization. Context not compacted. Error: ${err.message}`));
      }
      return false;
    } finally {
      pendingCompaction = false;
    }
  };

  const runAgentLoop = async (shouldExit = false) => {
    let loopDepth = 0;
    const executeLoop = async () => {
      loopDepth++;
      if (loopDepth > 15) {
        console.log(chalk.red(`\n⚠️  [System Guard] Maximum tool iteration depth (15) reached. Stopping loop to prevent resource drain.`));
        if (shouldExit) {
          indexer.close();
          sandbox.stop();
          rl.close();
          process.exit(1);
        } else {
          askQuestion();
        }
        return;
      }

      if (indexer && (indexer as any).watcher) {
        try {
          (indexer as any).watcher.flush();
        } catch (e) {}
      }

      const currentRepoMap = indexer.getRepoMap();
      const currentChanges = indexer.getRecentChanges();
      
      const systemMessage = {
        role: 'system',
        content: `${SYSTEM_INSTRUCTIONS}\n\n[Active Repository Map]\n${currentRepoMap}\n\n${currentChanges}`
      };

      const activePayload = [systemMessage, ...conversationHistory];

      let modelResponse = '';
      let isFirstChunk = true;
      let bufferedText = '';
      let inThinkBlock = false;
      let tempBuffer = '';
      const spinnerStartTime = Date.now();
      const minDelay = 2000;

      const spinner = new ThinkingSpinner();
      process.stdout.write('\n');
      spinner.start();

      let streamAccumulator = '';
      let printedStreamText = '';
      const streamState = {
        buffer: '',
        suppressed: false,
        inCodeBlock: false
      };

      const toolSpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let toolSpinnerIdx = 0;
      let toolSpinnerStarted = false;
      let toolSpinnerLinePrinted = false;

      const filterPrint = (text: string) => {
        const toPrint = processChunk(text, streamState);
        if (toPrint) {
          process.stdout.write(toPrint);
          printedStreamText += toPrint;
        }
        
        if (streamState.suppressed) {
          if (!toolSpinnerStarted) {
            toolSpinnerStarted = true;
            process.stdout.write(`\n  ${themeOrange(toolSpinnerFrames[0])} preparing tool call...`);
            toolSpinnerLinePrinted = true;
          } else {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            toolSpinnerIdx = (toolSpinnerIdx + 1) % toolSpinnerFrames.length;
            
            const writeMatch = /<write_file\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/write_file>|$)/.exec(streamAccumulator);
            let statusMsg = '';
            if (writeMatch) {
              const fileName = writeMatch[1];
              const contentSoFar = writeMatch[2];
              const charCount = contentSoFar.length;
              const lineCount = contentSoFar.split(/\r?\n/).length;
              statusMsg = `${themeGreen('write')} ${fileName} (${themeGreen(charCount.toLocaleString())} chars, ${themeGreen(lineCount)} lines)...`;
            } else {
              const runMatch = /<run_command\s*>([\s\S]*?)(?:<\/run_command>|$)/.exec(streamAccumulator);
              if (runMatch) {
                const cmdSoFar = runMatch[1].trim().replace(/\n/g, ' ');
                statusMsg = `${themePrimary('run')} ${cmdSoFar.substring(0, 50)}${cmdSoFar.length > 50 ? '...' : ''}...`;
              } else {
                let fileSoFar = '';
                const readAttrMatch = /<read_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(streamAccumulator);
                if (readAttrMatch) {
                  fileSoFar = readAttrMatch[1];
                } else {
                  const readTagMatch = /<read_file\s*>([\s\S]*?)(?:<\/read_file>|$)/.exec(streamAccumulator);
                  if (readTagMatch) {
                    fileSoFar = readTagMatch[1].trim();
                  }
                }
                
                if (fileSoFar) {
                  statusMsg = `${themeGreen('read')} ${fileSoFar}...`;
                } else {
                  const searchMatch = /<search_code\s*>([\s\S]*?)(?:<\/search_code>|$)/.exec(streamAccumulator);
                  if (searchMatch) {
                    const querySoFar = searchMatch[1].trim();
                    statusMsg = `${themeGreen('search')} index for "${querySoFar}"...`;
                  } else {
                    statusMsg = `preparing tool call...`;
                  }
                }
              }
            }
            
            process.stdout.write(`  ${themeOrange(toolSpinnerFrames[toolSpinnerIdx])} ${statusMsg}`);
          }
        }
      };

      const abortController = new AbortController();
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      const hasRawMode = typeof stdin.setRawMode === 'function';

      const onKeypress = (str: any, key: any) => {
        if (key) {
          if (key.name === 'escape') {
            abortController.abort();
          } else if (key.ctrl && key.name === 'c') {
            if (hasRawMode) {
              try {
                stdin.removeListener('keypress', onKeypress);
                stdin.setRawMode(wasRaw);
              } catch (_) {}
            }
            process.exit(130);
          }
        }
      };

      if (hasRawMode) {
        try {
          stdin.setRawMode(true);
          stdin.resume();
          readline.emitKeypressEvents(stdin);
          stdin.on('keypress', onKeypress);
        } catch (_) {}
      }

      try {
        try {
          const chatResult = await ollama.chatStream(
            activeModel,
            activePayload,
            contextLimit,
            (chunk) => {
              streamAccumulator += chunk;
              const elapsed = Date.now() - spinnerStartTime;
              if (elapsed < minDelay) {
                bufferedText += chunk;
              } else {
                if (isFirstChunk) {
                  isFirstChunk = false;
                  spinner.stop();
                  process.stdout.write(`${themeGreen('●')} `);
                  printedStreamText += '● ';
                  if (bufferedText) {
                    let textToPrint = bufferedText;
                    if (!thinkingEnabled) {
                      textToPrint = textToPrint.replace(/<think>[\s\S]*?<\/think>/g, '');
                      const startIdx = textToPrint.indexOf('<think>');
                      if (startIdx !== -1) {
                        inThinkBlock = true;
                        tempBuffer = textToPrint.substring(startIdx);
                        textToPrint = textToPrint.substring(0, startIdx);
                      }
                    }
                    if (textToPrint) {
                      filterPrint(textToPrint);
                    }
                    bufferedText = '';
                  }
                }
                
                if (!thinkingEnabled) {
                  tempBuffer += chunk;
                  if (!inThinkBlock) {
                    const thinkStartIdx = tempBuffer.indexOf('<think>');
                    if (thinkStartIdx !== -1) {
                      const before = tempBuffer.substring(0, thinkStartIdx);
                      if (before) filterPrint(before);
                      inThinkBlock = true;
                      tempBuffer = tempBuffer.substring(thinkStartIdx);
                    } else {
                      filterPrint(tempBuffer);
                      tempBuffer = '';
                    }
                  }
                  
                  if (inThinkBlock) {
                    const thinkEndIdx = tempBuffer.indexOf('</think>');
                    if (thinkEndIdx !== -1) {
                      inThinkBlock = false;
                      const after = tempBuffer.substring(thinkEndIdx + 8);
                      if (after) filterPrint(after);
                      tempBuffer = '';
                    } else {
                      const partialTagMatch = /<\/t?h?i?n?k?>?$/.exec(tempBuffer);
                      if (partialTagMatch) {
                        tempBuffer = partialTagMatch[0];
                      } else {
                        tempBuffer = '';
                      }
                    }
                  }
                } else {
                  filterPrint(chunk);
                }
              }
            },
            abortController.signal
          );
          modelResponse = chatResult.content;
          const usage = chatResult.usage;
          lastInputTokens = usage.input_tokens;

          const isCompactionSkipped = currentOperation === '/summary' || currentOperation === '/export' || currentOperation === '/sessions';
          if (!isCompactionSkipped) {
            const usageRatio = usage.input_tokens / contextLimit;
            if (usageRatio >= compactThreshold) {
              pendingCompaction = true;
            }
          }

          const elapsed = Date.now() - spinnerStartTime;
          if (elapsed < minDelay) {
            const remaining = minDelay - elapsed;
            await new Promise(resolve => setTimeout(resolve, remaining));
            isFirstChunk = false;
            spinner.stop();
            process.stdout.write(`${themeGreen('●')} `);
            printedStreamText += '● ';
            if (bufferedText) {
              let textToPrint = bufferedText;
              if (!thinkingEnabled) {
                textToPrint = textToPrint.replace(/<think>[\s\S]*?<\/think>/g, '');
              }
              if (textToPrint) {
                filterPrint(textToPrint);
              }
            }
          } else {
            spinner.stop();
          }
        } finally {
          if (hasRawMode) {
            try {
              stdin.removeListener('keypress', onKeypress);
              stdin.setRawMode(wasRaw);
            } catch (_) {}
          }
        }
      } catch (err: any) {
        spinner.stop();
        if (toolSpinnerLinePrinted) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          readline.moveCursor(process.stdout, 0, -1);
        }
        const cols = process.stdout.columns || 80;
        const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
        if (linesToClear > 0) {
          readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
          readline.cursorTo(process.stdout, 0);
          readline.clearScreenDown(process.stdout);
        }

        const isAbort = err.name === 'AbortError' || 
                        err.message?.includes('aborted') || 
                        err.message?.includes('Abort');

        if (isAbort) {
          console.log(themeRed('\n✗ Generation interrupted.'));
          if (shouldExit) {
            indexer.close();
            sandbox.stop();
            rl.close();
            process.exit(130);
          } else {
            askQuestion();
          }
          return;
        }

        console.error(chalk.red(`\n[Error] Connection failed: ${err.message}`));
        if (shouldExit) {
          indexer.close();
          sandbox.stop();
          rl.close();
          process.exit(1);
        } else {
          askQuestion();
        }
        return;
      }

      if (toolSpinnerLinePrinted) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        readline.moveCursor(process.stdout, 0, -1);
      }

      const cols = process.stdout.columns || 80;
      const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
      if (linesToClear > 0) {
        readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);
      }

      let cleanText = modelResponse
        .replace(/<run_command\s*>[\s\S]*?(?:<\/run_command>|$)/g, '')
        .replace(/<read_file\s*[^>]*>[\s\S]*?(?:<\/read_file>|$)/g, '')
        .replace(/<search_code\s*>[\s\S]*?(?:<\/search_code>|$)/g, '')
        .replace(/<write_file\s*[^>]*>[\s\S]*?(?:<\/write_file>|$)/g, '')
        .replace(/<patch_file\s*[^>]*>[\s\S]*?(?:<\/patch_file>|$)/g, '')
        .replace(/<patch_file_blocks\s*[^>]*>[\s\S]*?(?:<\/patch_file_blocks>|$)/g, '')
        .replace(/<list_dir\s*[^>]*>[\s\S]*?(?:<\/list_dir>|$)/g, '')
        .replace(/<git_status\s*[^>]*>[\s\S]*?(?:<\/git_status>|$)/g, '')
        .replace(/<diagnostics\s*[^>]*>[\s\S]*?(?:<\/diagnostics>|$)/g, '')
        .replace(/<move_file\s*[^>]*>[\s\S]*?(?:<\/move_file>|$)/g, '')
        .replace(/<(?:path_)?question\s*[^>]*\/>/g, '')
        .replace(/<(?:path_)?question\s*[^>]*>[\s\S]*?(?:<\/(?:path_)?question>|$)/g, '')
        .trim();

      if (!thinkingEnabled) {
        cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      } else {
        cleanText = cleanText.replace(/<think>([\s\S]*?)<\/think>/g, (_, thinkContent) => {
          const trimmed = thinkContent.trim();
          if (!trimmed) return '';
          const indented = trimmed.split('\n').map((l: string) => '    ' + l).join('\n');
          return `\n\n${chalk.gray.italic('🧠 Thinking:')}\n${chalk.gray.italic(indented)}\n\n`;
        }).trim();
      }

      if (cleanText) {
        const formatted = marked.parse(cleanText).toString().trim();
        console.log(`${themeGreen('●')} ${formatted}`);
      }

      const toolResult = await handleToolCalls(modelResponse, sandbox, indexer, rl);
      if (toolResult.toolRun) {
        conversationHistory.push({ role: 'assistant', content: modelResponse });
        conversationHistory.push({ role: 'user', content: toolResult.nextPrompt });
        await executeLoop();
      } else {
        conversationHistory.push({ role: 'assistant', content: modelResponse });

        if (pendingCompaction) {
          await runCompaction(true);
        }

        console.log('\n');
        if (shouldExit) {
          indexer.close();
          sandbox.stop();
          rl.close();
          process.exit(0);
        } else {
          askQuestion();
        }
      }
    };
    await executeLoop();
  };

  const askQuestion = () => {
    const cols = process.stdout.columns || 80;
    
    const leftSide = '';
    const wsName = path.basename(workspaceRoot);
    const rightSide = `${themeGreen(wsName)} (${themePrimary(gitBranch)})`;

    const leftVisualLen = stripAnsi(leftSide).length;
    const rightVisualLen = stripAnsi(rightSide).length;
    const paddingLen = Math.max(cols - leftVisualLen - rightVisualLen, 1);
    const statusBarText = leftSide + ' '.repeat(paddingLen) + rightSide;

    console.log(themeBorder('─'.repeat(cols)));
    console.log(statusBarText);

    rl.question(`${themePrimary.bold('unit01')} ${themeGreen('❯')} `, async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        askQuestion();
        return;
      }

      currentOperation = trimmed.startsWith('/') ? trimmed.split(/\s+/)[0] : null;

      if (trimmed.startsWith('/')) {
        const parts = trimmed.split(/\s+/);
        let command = parts[0].toLowerCase();
        let arg = parts.slice(1).join(' ');

        if (command === '/' || command === '/menu') {
          const menuOptions = [
            '🤖 Switch Model (/models)',
            '🧠 Toggle Thinking (/thinking)',
            '📊 Context Usage (/usage)',
            '💾 Export Session (/export)',
            '🔍 Preview Last File (/preview)',
            '📝 View Recent Changes (/changes)',
            '⏪ Revert Last Change (/undo)',
            '🔎 Search Codebase (/search)',
            '🧹 Clear History (/clear)',
            '🗜️ Compact Context (/compact)',
            'ℹ️ System Status (/status)',
            '📁 List Indexed Files (/files)',
            '🔄 Re-index Workspace (/reindex)',
            '❓ Show Help (/help)',
            '❌ Exit CLI (/exit)'
          ];
          const chosenIdx = await interactiveSelect('Command Menu:', menuOptions);
          if (chosenIdx === -1) {
            askQuestion();
            return;
          }
          const cmdMapping = [
            '/models',
            '/thinking',
            '/usage',
            '/export',
            '/preview',
            '/changes',
            '/undo',
            '/search',
            '/clear',
            '/compact',
            '/status',
            '/files',
            '/reindex',
            '/help',
            '/exit'
          ];
          command = cmdMapping[chosenIdx];
          arg = '';
          currentOperation = command;
        }

        if (command === '/exit' || command === '/quit') {
          console.log(chalk.yellow('Shutting down file watchers and sandbox proxies...'));
          indexer.close();
          sandbox.stop();
          rl.close();
          process.exit(0);
        }

        if (command === '/clear') {
          conversationHistory.length = 0;
          lastInputTokens = 0;
          console.log(chalk.gray('Conversation history cleared.'));
          askQuestion();
          return;
        }

        if (command === '/compact') {
          await runCompaction(false);
          askQuestion();
          return;
        }

        if (command === '/changes') {
          const changes = indexer.getRecentChanges();
          console.log(changes ? chalk.blue(changes) : chalk.gray('No recent changes logged.'));
          askQuestion();
          return;
        }

        if (command === '/search') {
          const runSearch = (queryStr: string) => {
            const results = indexer.search(queryStr);
            console.log(chalk.blue(`Found ${results.length} matches:`));
            results.slice(0, 5).forEach((r) => {
              console.log(chalk.cyan(`- ${r.relpath} (line ${r.start_line}-${r.end_line})`));
            });
          };

          if (!arg) {
            await new Promise<void>((resolve) => {
              rl.question('Enter search query: ', (query) => {
                const searchArg = query.trim();
                if (!searchArg) {
                  console.log(chalk.red('Search cancelled: empty query.'));
                } else {
                  runSearch(searchArg);
                }
                resolve();
              });
            });
          } else {
            runSearch(arg);
          }
          askQuestion();
          return;
        }

        if (command === '/undo') {
          const dbBackup = indexer['db']['db'].prepare('SELECT original_path FROM shadow_backups LIMIT 1').get() as { original_path: string } | undefined;
          if (dbBackup) {
            const restoredPath = dbBackup.original_path;
            const success = indexer.undoWrite(restoredPath);
            if (success) {
              sandbox.clearLoopHistory();
              console.log(chalk.green(`Successfully restored backup and reverted changes for: ${path.basename(restoredPath)}`));
            } else {
              console.log(chalk.red(`Failed to restore backup for ${restoredPath}`));
            }
          } else {
            console.log(chalk.gray('No backups found to undo.'));
          }
          askQuestion();
          return;
        }

        if (command === '/models') {
          if (arg) {
            const matchIndex = models.findIndex(m => m.name === arg);
            const numVal = parseInt(arg, 10);
            const matchNum = !isNaN(numVal) && numVal > 0 && numVal <= models.length ? numVal - 1 : -1;

            const targetIdx = matchIndex !== -1 ? matchIndex : matchNum;
            if (targetIdx !== -1) {
              await activateModel(models[targetIdx]);
            } else {
              console.log(chalk.red(`Model "${arg}" not found in local library.`));
            }
            askQuestion();
          } else {
            const modelOptions = models.map(m => `${m.displayName} (${m.parameterSize})`);
            const chosenIdx = await interactiveSelect('Select Active Model:', modelOptions);
            if (chosenIdx >= 0 && chosenIdx < models.length) {
              await activateModel(models[chosenIdx]);
            } else {
              console.log(chalk.red('Invalid selection. Keeping current model.'));
            }
            askQuestion();
          }
          return;
        }

        if (command === '/thinking') {
          const chosenIdx = await interactiveSelect('Model Thinking Mode:', [
            `Enable Thinking  ${thinkingEnabled ? '✓' : ''}`,
            `Disable Thinking ${!thinkingEnabled ? '✓' : ''}`
          ]);
          
          if (chosenIdx === 0) {
            thinkingEnabled = true;
            console.log(chalk.green('🧠 Model thinking enabled (reasoning blocks will be displayed).'));
          } else if (chosenIdx === 1) {
            thinkingEnabled = false;
            console.log(chalk.yellow('🧠 Model thinking disabled (reasoning blocks will be hidden).'));
          }
          askQuestion();
          return;
        }

        if (command === '/preview') {
          if (lastWrittenFile) {
            if (lastWrittenFile.original === null) {
              renderNewFileBlock(lastWrittenFile.content, getLanguageFromFilename(lastWrittenFile.filePath), lastWrittenFile.filePath);
            } else {
              renderSideBySideDiff(lastWrittenFile.original, lastWrittenFile.content, getLanguageFromFilename(lastWrittenFile.filePath), lastWrittenFile.filePath);
            }
          } else {
            console.log(chalk.gray('No pending or recently written files to preview.'));
          }
          askQuestion();
          return;
        }

        if (command === '/status') {
          const activeRepoMap = indexer.getRepoMap();
          const activeChanges = indexer.getRecentChanges();
          const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
          const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
          const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
          
          let progressColor = themeGreen;
          const ratio = Math.min(totalTokens / contextLimit, 1.0);
          if (ratio >= 0.8) {
            progressColor = chalk.red;
          } else if (ratio >= 0.6) {
            progressColor = chalk.yellow;
          }

          console.log(chalk.bold('\nUnit01 System Status:'));
          console.log(`- Active Model: ${chalk.green(activeModel)}`);
          console.log(`- Context Usage: ${progressColor(totalTokens.toLocaleString())} / ${chalk.gray(contextLimit.toLocaleString())} tokens (${progressColor(Math.round(ratio * 100) + '%')})`);
          console.log(`- Compact Threshold: ${chalk.green(compactThreshold)}`);
          console.log(`- Workspace Root: ${chalk.cyan(workspaceRoot)}`);
          console.log(`- Git Branch: ${chalk.cyan(gitBranch)}`);
          console.log(`- Egress Proxy Port: ${chalk.green(sandbox['proxyPort'] || 'inactive')}`);
          console.log(`- Files Indexed: ${chalk.green(indexer['db'].getAllFiles().length)}`);
          console.log(`- Allowed Paths:`);
          if (activeAllowedPaths.length === 0) {
            console.log(`  (none)`);
          } else {
            activeAllowedPaths.forEach(ap => {
              console.log(`  - ${chalk.cyan(ap.path)} (${chalk.green(ap.mode)})`);
            });
          }
          console.log();
          askQuestion();
          return;
        }

        if (command === '/usage') {
          const activeRepoMap = indexer.getRepoMap();
          const activeChanges = indexer.getRecentChanges();
          const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
          const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
          const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
          const ratio = Math.min(totalTokens / contextLimit, 1.0);
          const pct = Math.round(ratio * 100);
          const remaining = Math.max(0, contextLimit - totalTokens);

          let progressColor = themeGreen;
          if (ratio >= 0.8) {
            progressColor = chalk.red;
          } else if (ratio >= 0.6) {
            progressColor = chalk.yellow;
          }

          console.log(chalk.bold('\nContext Window Usage:'));
          console.log(`- Active Model:     ${chalk.cyan(activeModel)}`);
          console.log(`- Context Limit:    ${chalk.cyan(contextLimit.toLocaleString())} tokens`);
          console.log(`- Total Usage:      ${progressColor(totalTokens.toLocaleString())} / ${contextLimit.toLocaleString()} tokens (${progressColor(pct + '%')})`);
          console.log(`- System Context:   ${chalk.gray(systemPromptLength.toLocaleString())} tokens (instructions, repo map, recent changes)`);
          console.log(`- Messages History: ${chalk.gray(historyLength.toLocaleString())} tokens (${conversationHistory.length} messages)`);
          console.log(`- Remaining space:  ${progressColor(remaining.toLocaleString())} tokens`);
          
          // Visual progress bar
          const barWidth = 40;
          const filledWidth = Math.round(ratio * barWidth);
          const emptyWidth = barWidth - filledWidth;
          const bar = progressColor('█'.repeat(filledWidth)) + chalk.gray('░'.repeat(emptyWidth));
          console.log(`  [${bar}]`);
          console.log();

          askQuestion();
          return;
        }

        if (command === '/export') {
          if (conversationHistory.length === 0) {
            console.log(chalk.yellow('Nothing to export — conversation history is empty.'));
            askQuestion();
            return;
          }

          const homeDir = os.homedir();
          const sessionDir = path.join(homeDir, 'ruthen-sessions');

          // Ensure ruthen-sessions directory exists
          if (!fs.existsSync(sessionDir)) {
            try {
              fs.mkdirSync(sessionDir, { recursive: true });
            } catch (e: any) {
              console.error(chalk.red(`✗ Failed to create sessions directory: ${e.message}`));
            }
          }

          // YYYY-MM-DD
          const now = new Date();
          const yyyy = now.getFullYear();
          const mm = String(now.getMonth() + 1).padStart(2, '0');
          const dd = String(now.getDate()).padStart(2, '0');
          const dateStr = `${yyyy}-${mm}-${dd}`;

          // Find first user message (not tool output)
          const firstUserMsg = conversationHistory.find(m => m.role === 'user' && !m.content.includes('<tool_output>'));
          let suffix = '';
          if (firstUserMsg) {
            let sanitised = firstUserMsg.content.toLowerCase();
            sanitised = sanitised.replace(/\s+/g, '-');
            sanitised = sanitised.replace(/[^a-z0-9\-]/g, '');
            sanitised = sanitised.replace(/-+/g, '-');
            sanitised = sanitised.replace(/^-+|-+$/g, '');
            sanitised = sanitised.substring(0, 40);
            sanitised = sanitised.replace(/-+$/g, '');
            
            if (sanitised.length >= 3) {
              suffix = sanitised;
            }
          }

          if (!suffix) {
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            suffix = `${hh}-${min}-${ss}`;
          }

          const defaultPath = path.join(sessionDir, `${dateStr}-${suffix}.md`);

          let targetPath = arg.trim();
          if (!targetPath) {
            targetPath = defaultPath;
          } else {
            if (targetPath.startsWith('~/')) {
              targetPath = path.join(homeDir, targetPath.slice(2));
            } else {
              targetPath = path.resolve(workspaceRoot, targetPath);
            }
          }

          let finalPath = targetPath;
          if (fs.existsSync(finalPath)) {
            const answer = await new Promise<string>((resolve) => {
              rl.question(`File already exists at ${finalPath}. Overwrite? [y/N]: `, (ans) => {
                resolve(ans.trim().toLowerCase());
              });
            });

            if (answer !== 'y' && answer !== 'yes') {
              const ext = path.extname(finalPath);
              const dir = path.dirname(finalPath);
              const base = path.basename(finalPath, ext);
              let counter = 1;
              while (true) {
                const candidate = path.join(dir, `${base}-${counter}${ext}`);
                if (!fs.existsSync(candidate)) {
                  finalPath = candidate;
                  break;
                }
                counter++;
              }
            }
          }

          interface FileMod {
            file: string;
            action: 'created' | 'modified' | 'moved';
            toolUsed: string;
            edits: number;
          }

          const fileMods = new Map<string, FileMod>();

          function addOrMergeFileMod(file: string, action: 'created' | 'modified' | 'moved', toolUsed: string) {
            const normalized = path.normalize(file);
            const existing = fileMods.get(normalized);
            if (existing) {
              existing.edits += 1;
              if (existing.action !== 'created' && action === 'created') {
                existing.action = 'created';
              }
              existing.toolUsed = toolUsed;
            } else {
              fileMods.set(normalized, {
                file: normalized,
                action,
                toolUsed,
                edits: 1
              });
            }
          }

          for (const msg of conversationHistory) {
            if (msg.role !== 'assistant') continue;
            const content = msg.content;

            const writeAttrRegex = /<write_file\s+(?:relative_)?path=["']([^"']+)["']/g;
            let match;
            while ((match = writeAttrRegex.exec(content)) !== null) {
              addOrMergeFileMod(match[1], 'created', 'write_file');
            }

            const writeTagRegex = /<write_file\s*>([\s\S]*?)(?:<\/write_file>|$)/g;
            while ((match = writeTagRegex.exec(content)) !== null) {
              const lines = match[1].trim().split('\n');
              if (lines.length > 0 && lines[0].trim()) {
                addOrMergeFileMod(lines[0].trim(), 'created', 'write_file');
              }
            }

            const patchRegex = /<(patch_file|patch_file_blocks)\s+(?:relative_)?path=["']([^"']+)["']/g;
            while ((match = patchRegex.exec(content)) !== null) {
              addOrMergeFileMod(match[2], 'modified', match[1]);
            }

            const moveRegex = /<move_file\s+source_path=["']([^"']+)["']\s+destination_path=["']([^"']+)["']/g;
            while ((match = moveRegex.exec(content)) !== null) {
              addOrMergeFileMod(match[1], 'moved', 'move_file');
            }
          }

          let filesModifiedTable = '';
          if (fileMods.size === 0) {
            filesModifiedTable = '*No files were modified in this session.*';
          } else {
            filesModifiedTable = '| File | Action | Tool Used | Edits |\n|------|--------|-----------|-------|\n';
            for (const mod of fileMods.values()) {
              filesModifiedTable += `| ${mod.file} | ${mod.action} | ${mod.toolUsed} | ${mod.edits} |\n`;
            }
          }

          const commandsRun: { command: string; outcome: string }[] = [];
          for (let i = 0; i < conversationHistory.length; i++) {
            const msg = conversationHistory[i];
            if (msg.role !== 'assistant') continue;

            let match;
            const runRegex = /<run_command\s*>([\s\S]*?)<\/run_command>/g;
            while ((match = runRegex.exec(msg.content)) !== null) {
              const cmd = match[1].trim();
              let outcome = '✓ passed';
              if (i + 1 < conversationHistory.length) {
                const nextMsg = conversationHistory[i + 1];
                if (nextMsg.role === 'user' && nextMsg.content.includes('<tool_output>')) {
                  const outputMatch = /<tool_output\s*>([\s\S]*?)<\/tool_output>/.exec(nextMsg.content);
                  const output = outputMatch ? outputMatch[1].trim() : nextMsg.content.trim();
                  if (output.startsWith('[Command failed') || output.includes('exit code') && !output.includes('exit code 0')) {
                    outcome = '✗ failed';
                  }
                }
              }
              commandsRun.push({ command: cmd, outcome });
            }
          }

          let commandsRunTable = '';
          if (commandsRun.length > 0) {
            commandsRunTable = '## Commands Run\n\n| Command | Outcome |\n|---------|---------|\n';
            for (const cmd of commandsRun) {
              commandsRunTable += `| ${cmd.command} | ${cmd.outcome} |\n`;
            }
            commandsRunTable += '\n';
          }

          let secretsRedacted = false;
          function redactWithNotice(c: string): string {
            const redacted = redactSecrets(c);
            if (redacted !== c) {
              secretsRedacted = true;
            }
            return redacted;
          }

          function parseCommandResult(output: string): { status: string; code: string } {
            const failMatch = /exit code (\d+)/i.exec(output);
            if (failMatch) {
              const code = parseInt(failMatch[1], 10);
              if (code === 0) return { status: '✓ exit code 0', code: '0' };
              return { status: `✗ exit code ${code}`, code: String(code) };
            }
            if (output.includes('Command failed') || output.includes('Error:')) {
              return { status: '✗ failed', code: '1' };
            }
            return { status: '✓ exit code 0', code: '0' };
          }

          const durationMs = Date.now() - sessionStartTime;
          function formatDuration(ms: number): string {
            const seconds = Math.floor((ms / 1000) % 60);
            const minutes = Math.floor((ms / (1000 * 60)) % 60);
            const hours = Math.floor(ms / (1000 * 60 * 60));
            const parts = [];
            if (hours > 0) parts.push(`${hours}h`);
            if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
            parts.push(`${seconds}s`);
            return parts.join(' ');
          }

          const durationStr = formatDuration(durationMs);
          const fullDateStr = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date());
          const exportTimestamp = new Date().toISOString();

          let conversationMarkdown = '';
          for (let idx = 0; idx < conversationHistory.length; idx++) {
            const msg = conversationHistory[idx];
            if (msg.role === 'system') {
              const compactMatch = /\[COMPACTED CONTEXT — conversation summarised at ([^\]]+)\]\n\n([\s\S]*)/.exec(msg.content);
              if (compactMatch) {
                const timestamp = compactMatch[1].trim();
                const summaryContent = compactMatch[2].trim();
                conversationMarkdown += `### ⚡ Context Compacted\n*Conversation history was compacted at ${timestamp}. Summary below:*\n${summaryContent}\n\n`;
              } else {
                conversationMarkdown += `### ⚙️ System\n${msg.content}\n\n`;
              }
            } else if (msg.role === 'user') {
              if (msg.content.includes('<tool_output>')) {
                continue;
              }
              conversationMarkdown += `### 👤 User\n${msg.content.trim()}\n\n`;
            } else if (msg.role === 'assistant') {
              const prose = msg.content
                .replace(/<run_command\s*>[\s\S]*?(?:<\/run_command>|$)/g, '')
                .replace(/<read_file\s*[^>]*>[\s\S]*?(?:<\/read_file>|$)/g, '')
                .replace(/<search_code\s*>[\s\S]*?(?:<\/search_code>|$)/g, '')
                .replace(/<write_file\s*[^>]*>[\s\S]*?(?:<\/write_file>|$)/g, '')
                .replace(/<patch_file\s*[^>]*>[\s\S]*?(?:<\/patch_file>|$)/g, '')
                .replace(/<patch_file_blocks\s*[^>]*>[\s\S]*?(?:<\/patch_file_blocks>|$)/g, '')
                .replace(/<list_dir\s*[^>]*>[\s\S]*?(?:<\/list_dir>|$)/g, '')
                .replace(/<git_status\s*[^>]*>[\s\S]*?(?:<\/git_status>|$)/g, '')
                .replace(/<diagnostics\s*[^>]*>[\s\S]*?(?:<\/diagnostics>|$)/g, '')
                .replace(/<move_file\s*[^>]*>[\s\S]*?(?:<\/move_file>|$)/g, '')
                .replace(/<(?:path_)?question\s*[^>]*\/>/g, '')
                .replace(/<(?:path_)?question\s*[^>]*>[\s\S]*?(?:<\/(?:path_)?question>|$)/g, '')
                .trim();

              if (prose) {
                conversationMarkdown += `### 🤖 Agent\n${prose}\n\n`;
              }

              const toolCallRegex = /<(run_command|read_file|write_file|patch_file|patch_file_blocks|search_code|list_dir|git_status|diagnostics|move_file|question|path_question)(\s+[^>]*?)(?:>([\s\S]*?)(?:<\/\1>|$)|\s*\/>)/g;
              let toolMatch;
              while ((toolMatch = toolCallRegex.exec(msg.content)) !== null) {
                const toolName = toolMatch[1];
                let toolOutputContent = '';
                
                for (let k = idx + 1; k < conversationHistory.length; k++) {
                  if (conversationHistory[k].role === 'user' && conversationHistory[k].content.includes('<tool_output>')) {
                    toolOutputContent = conversationHistory[k].content;
                    break;
                  }
                  if (conversationHistory[k].role === 'assistant') {
                    break;
                  }
                }

                let rawOutput = '';
                const outputMatch = /<tool_output\s*>([\s\S]*?)<\/tool_output>/.exec(toolOutputContent);
                if (outputMatch) {
                  rawOutput = outputMatch[1].trim();
                } else {
                  rawOutput = toolOutputContent.trim();
                }

                if (toolName === 'write_file') {
                  let file = '';
                  const pathAttr = /path=["']([^"']+)["']/.exec(toolMatch[2]);
                  let fileContent = '';
                  if (pathAttr) {
                    file = pathAttr[1];
                    fileContent = toolMatch[3] || '';
                  } else {
                    const lines = (toolMatch[3] || '').trim().split('\n');
                    if (lines.length > 0) {
                      file = lines[0].trim();
                      fileContent = lines.slice(1).join('\n');
                    }
                  }

                  let resultStatus = '✓ success';
                  if (rawOutput.includes('Error') || rawOutput.startsWith('Error')) {
                    resultStatus = '✗ failure';
                  }

                  const lineCount = fileContent.split('\n').length;
                  conversationMarkdown += `### 🔧 Tool Call: write_file\n`;
                  conversationMarkdown += `**File:** ${file}\n`;
                  conversationMarkdown += `**Result:** ${resultStatus}\n\n`;

                  if (lineCount <= 500) {
                    const lang = getLanguageFromFilename(file);
                    const redactedContent = redactWithNotice(fileContent);
                    conversationMarkdown += `\`\`\`${lang}\n${redactedContent}\n\`\`\`\n\n`;
                  } else {
                    conversationMarkdown += `[File content omitted — ${lineCount} lines. See ${file}]\n\n`;
                  }
                } else if (toolName === 'run_command') {
                  const cmd = (toolMatch[3] || '').trim();
                  const cmdResult = parseCommandResult(rawOutput);

                  const outputLines = rawOutput.split('\n');
                  let truncatedOutput = outputLines.slice(0, 100).join('\n');
                  if (outputLines.length > 100) {
                    truncatedOutput += `\n\n[Output truncated to 100 lines — ${outputLines.length - 100} lines omitted]`;
                  }
                  const redactedOutput = redactWithNotice(truncatedOutput);

                  conversationMarkdown += `### 🔧 Tool Call: run_command\n`;
                  conversationMarkdown += `**Command:** \`${cmd}\`\n`;
                  conversationMarkdown += `**Result:** ${cmdResult.status}\n`;
                  conversationMarkdown += `**Output:**\n\`\`\`\n${redactedOutput}\n\`\`\`\n\n`;
                } else {
                  let details = '';
                  if (toolName === 'patch_file' || toolName === 'patch_file_blocks' || toolName === 'read_file') {
                    const pathAttr = /path=["']([^"']+)["']/.exec(toolMatch[2]);
                    if (pathAttr) details = `**File:** ${pathAttr[1]}`;
                  } else if (toolName === 'move_file') {
                    const srcAttr = /source_path=["']([^"']+)["']/.exec(toolMatch[2]);
                    const destAttr = /destination_path=["']([^"']+)["']/.exec(toolMatch[2]);
                    if (srcAttr && destAttr) details = `**Source:** ${srcAttr[1]}\n**Destination:** ${destAttr[1]}`;
                  } else if (toolName === 'search_code') {
                    details = `**Query:** \`${(toolMatch[3] || '').trim()}\``;
                  }

                  let resultStatus = '✓ success';
                  if (rawOutput.includes('Error') || rawOutput.startsWith('Error')) {
                    resultStatus = '✗ failure';
                  }

                  conversationMarkdown += `### 🔧 Tool Call: ${toolName}\n`;
                  if (details) {
                    conversationMarkdown += `${details}\n`;
                  }
                  conversationMarkdown += `**Result:** ${resultStatus}\n\n`;
                }
              }
            }
          }

          let metadataNotice = '';
          if (secretsRedacted) {
            metadataNotice = `\n> ⚠ Note: Secret patterns were automatically redacted from this export.\n`;
          }

          const exportMarkdown = `# Ruthen Session — ${fullDateStr}\n\n` +
            `**Duration:** ${durationStr}\n` +
            `**Messages:** ${conversationHistory.length}\n` +
            `**Workspace:** ${workspaceRoot}\n` +
            `**Model:** ${activeModel}\n` +
            `**Exported:** ${exportTimestamp}\n` +
            metadataNotice +
            `\n---\n\n` +
            `## Files Modified This Session\n\n` +
            filesModifiedTable +
            `\n\n` +
            commandsRunTable +
            `---\n\n` +
            `## Full Conversation\n\n` +
            conversationMarkdown;

          try {
            fs.mkdirSync(path.dirname(finalPath), { recursive: true });
            fs.writeFileSync(finalPath, exportMarkdown, 'utf8');
            const stats = fs.statSync(finalPath);
            const sizeKb = (stats.size / 1024).toFixed(0);

            let displayPath = finalPath;
            if (displayPath.startsWith(homeDir)) {
              displayPath = '~' + displayPath.slice(homeDir.length);
            }

            console.log(chalk.green(`✓ Session exported to ${displayPath} (${sizeKb} KB)`));
          } catch (e: any) {
            console.error(chalk.red(`✗ Failed to write export file: ${e.message}`));
          }

          askQuestion();
          return;
        }

        if (command === '/files') {
          const allFiles = indexer['db'].getAllFiles();
          console.log(chalk.bold(`\nIndexed Files (${allFiles.length}):`));
          allFiles.forEach(f => {
            const rel = path.relative(workspaceRoot, f.path);
            console.log(`  - ${chalk.cyan(rel)} (${chalk.gray((f.size / 1024).toFixed(1) + ' KB')})`);
          });
          console.log();
          askQuestion();
          return;
        }

        if (command === '/reindex') {
          console.log(chalk.yellow('Re-scanning workspace and rebuilding index...'));
          await indexer.initialize();
          console.log(chalk.green('Index successfully rebuilt.'));
          askQuestion();
          return;
        }

        if (command === '/help') {
          console.log(chalk.bold('\nUnit01 CLI Help Menu'));
          console.log('Commands:');
          console.log(`  ${chalk.cyan('/models')}            - Switch the active Ollama model`);
          console.log(`  ${chalk.cyan('/thinking')}          - Toggle showing/hiding LLM thinking blocks`);
          console.log(`  ${chalk.cyan('/usage')}             - Show the context usage for the active model`);
          console.log(`  ${chalk.cyan('/export [path]')}     - Export current session to a markdown file`);
          console.log(`  ${chalk.cyan('/preview')}           - Preview side-by-side diff of the last written file`);
          console.log(`  ${chalk.cyan('/changes')}           - View list of recently modified files`);
          console.log(`  ${chalk.cyan('/undo')}              - Revert the last file modification`);
          console.log(`  ${chalk.cyan('/search <query>')}    - Search codebase chunks using keyword index`);
          console.log(`  ${chalk.cyan('/clear')}             - Clear conversation history`);
          console.log(`  ${chalk.cyan('/compact')}           - Summarise and compress conversation history to free context space`);
          console.log(`  ${chalk.cyan('/status')}            - Show system status`);
          console.log(`  ${chalk.cyan('/files')}             - List all currently indexed files`);
          console.log(`  ${chalk.cyan('/reindex')}           - Force full codebase scan and rebuild repo map`);
          console.log(`  ${chalk.cyan('/help')}              - Show this help menu`);
          console.log(`  ${chalk.cyan('/exit, /quit')}       - Exit the application`);
          console.log();
          askQuestion();
          return;
        }

        console.log(chalk.red(`Unknown command: ${command}`));
        askQuestion();
        return;
      }



      readline.moveCursor(process.stdout, 0, -1);
      readline.clearLine(process.stdout, 0);
      console.log(`${themePrimary.bold('unit01')} ${themeGreen('❯')} ${chalk.bgHex('#2B2B2B').white(' ' + input + ' ')}`);

      conversationHistory.push({ role: 'user', content: trimmed });

      // Run recursive LLM agent generation loop
      let loopDepth = 0;
      const runAgentLoop = async (shouldExit = false) => {
        loopDepth++;
        if (loopDepth > 15) {
          console.log(chalk.red(`\n⚠️  [System Guard] Maximum tool iteration depth (15) reached. Stopping loop to prevent resource drain.`));
          if (shouldExit) {
            indexer.close();
            sandbox.stop();
            rl.close();
            process.exit(1);
          } else {
            askQuestion();
          }
          return;
        }

        if (indexer && (indexer as any).watcher) {
          try {
            (indexer as any).watcher.flush();
          } catch (e) {}
        }

        const currentRepoMap = indexer.getRepoMap();
        const currentChanges = indexer.getRecentChanges();
        
        const systemMessage = {
          role: 'system',
          content: `${SYSTEM_INSTRUCTIONS}\n\n[Active Repository Map]\n${currentRepoMap}\n\n${currentChanges}`
        };

        const activePayload = [systemMessage, ...conversationHistory];

        let modelResponse = '';
        let isFirstChunk = true;
        let bufferedText = '';
        let inThinkBlock = false;
        let tempBuffer = '';
        const spinnerStartTime = Date.now();
        const minDelay = 2000; // 2 seconds minimum thinking display

        const spinner = new ThinkingSpinner();
        process.stdout.write('\n');
        spinner.start();

        let streamAccumulator = '';
        let printedStreamText = '';
        const streamState = {
          buffer: '',
          suppressed: false,
          inCodeBlock: false
        };

        const toolSpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let toolSpinnerIdx = 0;
        let toolSpinnerStarted = false;
        let toolSpinnerLinePrinted = false;

        const filterPrint = (text: string) => {
          const toPrint = processChunk(text, streamState);
          if (toPrint) {
            process.stdout.write(toPrint);
            printedStreamText += toPrint;
          }
          
          if (streamState.suppressed) {
            if (!toolSpinnerStarted) {
              toolSpinnerStarted = true;
              process.stdout.write(`\n  ${themeOrange(toolSpinnerFrames[0])} preparing tool call...`);
              toolSpinnerLinePrinted = true;
            } else {
              readline.clearLine(process.stdout, 0);
              readline.cursorTo(process.stdout, 0);
              toolSpinnerIdx = (toolSpinnerIdx + 1) % toolSpinnerFrames.length;
              
              // Extract details from streamAccumulator
              const writeMatch = /<write_file\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/write_file>|$)/.exec(streamAccumulator);
              let statusMsg = '';
              if (writeMatch) {
                const fileName = writeMatch[1];
                const contentSoFar = writeMatch[2];
                const charCount = contentSoFar.length;
                const lineCount = contentSoFar.split(/\r?\n/).length;
                statusMsg = `${themeGreen('write')} ${fileName} (${themeGreen(charCount.toLocaleString())} chars, ${themeGreen(lineCount)} lines)...`;
              } else {
                const runMatch = /<run_command\s*>([\s\S]*?)(?:<\/run_command>|$)/.exec(streamAccumulator);
                if (runMatch) {
                  const cmdSoFar = runMatch[1].trim().replace(/\n/g, ' ');
                  statusMsg = `${themePrimary('run')} ${cmdSoFar.substring(0, 50)}${cmdSoFar.length > 50 ? '...' : ''}...`;
                } else {
                  // Support both <read_file path="..."> and <read_file>path</read_file>
                  let fileSoFar = '';
                  const readAttrMatch = /<read_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(streamAccumulator);
                  if (readAttrMatch) {
                    fileSoFar = readAttrMatch[1];
                  } else {
                    const readTagMatch = /<read_file\s*>([\s\S]*?)(?:<\/read_file>|$)/.exec(streamAccumulator);
                    if (readTagMatch) {
                      fileSoFar = readTagMatch[1].trim();
                    }
                  }
                  
                  if (fileSoFar) {
                    statusMsg = `${themeGreen('read')} ${fileSoFar}...`;
                  } else {
                    const searchMatch = /<search_code\s*>([\s\S]*?)(?:<\/search_code>|$)/.exec(streamAccumulator);
                    if (searchMatch) {
                      const querySoFar = searchMatch[1].trim();
                      statusMsg = `${themeGreen('search')} index for "${querySoFar}"...`;
                    } else {
                      statusMsg = `preparing tool call...`;
                    }
                  }
                }
              }
              
              process.stdout.write(`  ${themeOrange(toolSpinnerFrames[toolSpinnerIdx])} ${statusMsg}`);
            }
          }
        };

        const abortController = new AbortController();
        const stdin = process.stdin;
        const wasRaw = stdin.isRaw;
        const hasRawMode = typeof stdin.setRawMode === 'function';

        const onKeypress = (str: any, key: any) => {
          if (key) {
            if (key.name === 'escape') {
              abortController.abort();
            } else if (key.ctrl && key.name === 'c') {
              if (hasRawMode) {
                try {
                  stdin.removeListener('keypress', onKeypress);
                  stdin.setRawMode(wasRaw);
                } catch (_) {}
              }
              process.exit(130);
            }
          }
        };

        if (hasRawMode) {
          try {
            stdin.setRawMode(true);
            stdin.resume();
            readline.emitKeypressEvents(stdin);
            stdin.on('keypress', onKeypress);
          } catch (_) {}
        }

        try {
          try {
            const chatResult = await ollama.chatStream(
              activeModel,
              activePayload,
              contextLimit,
              (chunk) => {
                streamAccumulator += chunk;
                if (hasRepetitionLoop(streamAccumulator)) {
                  throw new Error('REPETITION_LOOP');
                }
                const elapsed = Date.now() - spinnerStartTime;
                if (elapsed < minDelay) {
                  bufferedText += chunk;
                } else {
                  if (isFirstChunk) {
                    isFirstChunk = false;
                    spinner.stop();
                    process.stdout.write(`${themeGreen('●')} `);
                    printedStreamText += '● ';
                    if (bufferedText) {
                      let textToPrint = bufferedText;
                      if (!thinkingEnabled) {
                        textToPrint = textToPrint.replace(/<think>[\s\S]*?<\/think>/g, '');
                        const startIdx = textToPrint.indexOf('<think>');
                        if (startIdx !== -1) {
                          inThinkBlock = true;
                          tempBuffer = textToPrint.substring(startIdx);
                          textToPrint = textToPrint.substring(0, startIdx);
                        }
                      }
                      if (textToPrint) {
                        filterPrint(textToPrint);
                      }
                      bufferedText = '';
                    }
                  }
                  
                  if (!thinkingEnabled) {
                    tempBuffer += chunk;
                    if (!inThinkBlock) {
                      const thinkStartIdx = tempBuffer.indexOf('<think>');
                      if (thinkStartIdx !== -1) {
                        const before = tempBuffer.substring(0, thinkStartIdx);
                        if (before) filterPrint(before);
                        inThinkBlock = true;
                        tempBuffer = tempBuffer.substring(thinkStartIdx);
                      } else {
                        filterPrint(tempBuffer);
                        tempBuffer = '';
                      }
                    }
                    
                    if (inThinkBlock) {
                      const thinkEndIdx = tempBuffer.indexOf('</think>');
                      if (thinkEndIdx !== -1) {
                        inThinkBlock = false;
                        const after = tempBuffer.substring(thinkEndIdx + 8);
                        if (after) filterPrint(after);
                        tempBuffer = '';
                      } else {
                        const partialTagMatch = /<\/t?h?i?n?k?>?$/.exec(tempBuffer);
                        if (partialTagMatch) {
                          tempBuffer = partialTagMatch[0];
                        } else {
                          tempBuffer = '';
                        }
                      }
                    }
                  } else {
                    filterPrint(chunk);
                  }
                }
              },
              abortController.signal
            );
            modelResponse = chatResult.content;
            const usage = chatResult.usage;
            lastInputTokens = usage.input_tokens;

            const isCompactionSkipped = currentOperation === '/summary' || currentOperation === '/export' || currentOperation === '/sessions';
            if (!isCompactionSkipped) {
              const usageRatio = usage.input_tokens / contextLimit;
              if (usageRatio >= compactThreshold) {
                pendingCompaction = true;
              }
            }

            // If the model finished before the minimum spinner delay, wait and flush
            const elapsed = Date.now() - spinnerStartTime;
            if (elapsed < minDelay) {
              const remaining = minDelay - elapsed;
              await new Promise(resolve => setTimeout(resolve, remaining));
              isFirstChunk = false;
              spinner.stop();
              process.stdout.write(`${themeGreen('●')} `);
              printedStreamText += '● ';
              if (bufferedText) {
                let textToPrint = bufferedText;
                if (!thinkingEnabled) {
                  textToPrint = textToPrint.replace(/<think>[\s\S]*?<\/think>/g, '');
                }
                if (textToPrint) {
                  filterPrint(textToPrint);
                }
              }
            } else {
              spinner.stop();
            }
          } finally {
            if (hasRawMode) {
              try {
                stdin.removeListener('keypress', onKeypress);
                stdin.setRawMode(wasRaw);
              } catch (_) {}
            }
          }
        } catch (err: any) {
          spinner.stop();
          if (err.message === 'REPETITION_LOOP') {
            if (toolSpinnerLinePrinted) {
              readline.clearLine(process.stdout, 0);
              readline.cursorTo(process.stdout, 0);
              readline.moveCursor(process.stdout, 0, -1);
            }
            const cols = process.stdout.columns || 80;
            const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
            if (linesToClear > 0) {
              readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
              readline.cursorTo(process.stdout, 0);
              readline.clearScreenDown(process.stdout);
            }
            console.log(themeRed('\n✗ [System Guard] Generation aborted: text repetition loop detected.'));
            conversationHistory.push({
              role: 'system',
              content: '[SYSTEM] Generation aborted due to repeating text. Please generate your response concisely without repetitions.'
            });
            await runAgentLoop(shouldExit);
            return;
          }

          if (toolSpinnerLinePrinted) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            readline.moveCursor(process.stdout, 0, -1);
          }
          const cols = process.stdout.columns || 80;
          const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
          if (linesToClear > 0) {
            readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
            readline.cursorTo(process.stdout, 0);
            readline.clearScreenDown(process.stdout);
          }

          const isAbort = err.name === 'AbortError' || 
                          err.message?.includes('aborted') || 
                          err.message?.includes('Abort');

          if (isAbort) {
            console.log(themeRed('\n✗ Generation interrupted.'));
            if (shouldExit) {
              indexer.close();
              sandbox.stop();
              rl.close();
              process.exit(130);
            } else {
              askQuestion();
            }
            return;
          }

          console.error(chalk.red(`\n[Error] Connection failed: ${err.message}`));
          if (shouldExit) {
            indexer.close();
            sandbox.stop();
            rl.close();
            process.exit(1);
          } else {
            askQuestion();
          }
          return;
        }

        // Clean up tool spinner line if printed
        if (toolSpinnerLinePrinted) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          readline.moveCursor(process.stdout, 0, -1);
        }

        // Stream-then-Rewrite Pattern: Clear raw stream output and print formatted markdown response
        const cols = process.stdout.columns || 80;
        const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
        if (linesToClear > 0) {
          readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
          readline.cursorTo(process.stdout, 0);
          readline.clearScreenDown(process.stdout);
        }

        // Strip tool tags so only the explanation text is rendered as markdown
        let cleanText = modelResponse
          .replace(/<run_command\s*>[\s\S]*?(?:<\/run_command>|$)/g, '')
          .replace(/<read_file\s*[^>]*>[\s\S]*?(?:<\/read_file>|$)/g, '')
          .replace(/<search_code\s*>[\s\S]*?(?:<\/search_code>|$)/g, '')
          .replace(/<write_file\s*[^>]*>[\s\S]*?(?:<\/write_file>|$)/g, '')
          .replace(/<patch_file\s*[^>]*>[\s\S]*?(?:<\/patch_file>|$)/g, '')
          .replace(/<patch_file_blocks\s*[^>]*>[\s\S]*?(?:<\/patch_file_blocks>|$)/g, '')
          .replace(/<list_dir\s*[^>]*>[\s\S]*?(?:<\/list_dir>|$)/g, '')
          .replace(/<git_status\s*[^>]*>[\s\S]*?(?:<\/git_status>|$)/g, '')
          .replace(/<diagnostics\s*[^>]*>[\s\S]*?(?:<\/diagnostics>|$)/g, '')
          .replace(/<move_file\s*[^>]*>[\s\S]*?(?:<\/move_file>|$)/g, '')
          .replace(/<(?:path_)?question\s*[^>]*\/>/g, '')
          .replace(/<(?:path_)?question\s*[^>]*>[\s\S]*?(?:<\/(?:path_)?question>|$)/g, '')
          .trim();

        if (!thinkingEnabled) {
          cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        } else {
          // Format think blocks nicely in slate-gray side-bordered box
          cleanText = cleanText.replace(/<think>([\s\S]*?)<\/think>/g, (_, thinkContent) => {
            const trimmed = thinkContent.trim();
            if (!trimmed) return '';
            const bordered = trimmed.split('\n').map((l: string) => `  ${themeGray('│')} ${themeGray.italic(l)}`).join('\n');
            return `\n\n  ${themeGray.bold('🧠 Thinking:')}\n${bordered}\n\n`;
          }).trim();
        }

        if (cleanText) {
          const formatted = marked.parse(cleanText).toString().trim();
          console.log(`${themeGreen('●')} ${formatted}`);
        }

        // Parse tool calls in output
        const toolResult = await handleToolCalls(modelResponse, sandbox, indexer, rl);
        if (toolResult.toolRun) {
          conversationHistory.push({ role: 'assistant', content: modelResponse });
          conversationHistory.push({ role: 'user', content: toolResult.nextPrompt });
          await runAgentLoop(shouldExit);
        } else {
          conversationHistory.push({ role: 'assistant', content: modelResponse });
          
          if (pendingCompaction) {
            await runCompaction(true);
          }

          console.log('\n');
          if (shouldExit) {
            indexer.close();
            sandbox.stop();
            rl.close();
            process.exit(0);
          } else {
            askQuestion();
          }
        }
      };

      await runAgentLoop(false);
    });
  };

  if (nonInteractivePrompt) {
    conversationHistory.push({ role: 'user', content: nonInteractivePrompt });
    await runAgentLoop(true);
  } else {
    askQuestion();
  }
}

startCli().catch(err => {
  console.error(chalk.red('CLI failed to initialize:'), err);
});
