import * as readline from 'readline';
import * as path from 'path';
import chalk from 'chalk';
import { marked } from 'marked';
// @ts-ignore
import { markedTerminal } from 'marked-terminal';
import { highlight as highlightCli } from 'cli-highlight';

// Theme definition (Glacier & Steel Blue theme)
export const themePrimary = chalk.hex('#60A5FA'); // Glacier Steel Blue
export const themeBorder = chalk.hex('#334155'); // Slate Blue for structural borders
export const themeGreen = chalk.hex('#2DD4BF'); // Icy Teal / Mint for success
export const themeGreenLight = chalk.hex('#93C5FD'); // Sky Mist for info
export const themeOrange = chalk.hex('#F59E0B'); // Warm Amber for progress
export const themeGray = chalk.hex('#64748B'); // Cool Slate Gray
export const themeRed = chalk.hex('#FB7185'); // Icy Rose / Crimson for errors
export const themeBgDeep = '#0F172A'; // Slate 900 for dark background highlights

export function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// Helper to count visual lines of text given the terminal width
export function countVisualLines(text: string, cols: number): number {
  const lines = text.split('\n');
  let totalLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ');
    const clean = stripAnsi(line);
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
export function hasRepetitionLoop(text: string): boolean {
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

export function getRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) {
    return 'just now';
  }
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

export class ThinkingSpinner {
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

export function interactiveSelect(title: string, options: string[]): Promise<number> {
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
  const stripAnsiLocal = (str: string) => str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const visualLengths = lines.map(line => stripAnsiLocal(line.replace(/\t/g, '    ')).length);
  const maxLineLen = Math.max(...visualLengths, 0);

  const cols = process.stdout.columns || 80;
  const maxCodeWidth = cols - 8;
  const padWidth = Math.min(Math.max(maxLineLen + 4, 40), maxCodeWidth);

  const bgOpen = '\u001b[48;2;30;30;30m'; // #1E1E1E background
  const ansiReset = '\u001b[0m'; // Full reset

  const topBottomPadding = '  ' + bgOpen + ' '.repeat(padWidth) + ansiReset;
  const styledLines = lines.map(line => {
    const expanded = line.replace(/\t/g, '    ');
    const len = stripAnsiLocal(expanded).length;
    const padding = ' '.repeat(Math.max(padWidth - len, 0));
    return '  ' + bgOpen + line.replaceAll(ansiReset, ansiReset + bgOpen) + padding + ansiReset;
  });

  return '\n' + [topBottomPadding, ...styledLines, topBottomPadding].join('\n') + '\n\n';
};

marked.use(markedRenderer);

export function truncateAnsiString(str: string, maxLength: number): string {
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

export function diffLines(oldLines: string[], newLines: string[]): { type: 'added' | 'removed' | 'unchanged'; text: string }[] {
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

export function renderSideBySideDiff(original: string, modified: string, language: string, filePath: string) {
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

export function renderNewFileBlock(content: string, language: string, filePath: string) {
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

/**
 * Renders the clean Claude Code-style header (mascot on left, metadata on right)
 */
export function printWelcomeBanner(workspaceRoot: string, modelName: string, contextLimit: number, fileCount: number) {
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

// Note: This function contains a hardcoded list of tool tag names that must be kept in sync manually if new tools are added elsewhere in the codebase.
export function processChunk(chunk: string, state: { buffer: string; suppressed: boolean; inCodeBlock?: boolean }): string {
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
