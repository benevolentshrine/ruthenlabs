import * as readline from 'readline';
import * as path from 'path';
import chalk from 'chalk';
import { marked } from 'marked';
// @ts-ignore
import { markedTerminal } from 'marked-terminal';
import { highlight as highlightCli } from 'cli-highlight';

// Theme: Amber & Silver (Complementary Warm)
export const themePrimary     = chalk.hex('#E2E8F0'); // Silver Slate — structure, identity
export const themeBorder      = chalk.hex('#475569'); // Muted Slate — rules, borders
export const themeGold        = chalk.hex('#F59E0B'); // Amber Gold — active, selected, spinner
export const themeOrange      = chalk.hex('#F59E0B'); // alias for themeGold (backwards compat)
export const themeAccent      = chalk.hex('#F97316'); // Warm Orange — success, AI voice, status
export const themeAccentLight = chalk.hex('#FAB387'); // Peach — info, inline code
export const themeGray        = chalk.hex('#64748B'); // Muted Slate — secondary text
export const themeRed         = chalk.hex('#F87171'); // Coral Red — errors, failures
export const themeBg          = '#1E293B';            // Base Slate — code bg
export const themeBgDeep      = '#0F172A';            // Dark Slate — background

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

// Sanskrit characters for cascade animation
const SANSKRIT_CHARS = 'अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह'.split('');
// Gold gradient palette for cascade (warm → cool → warm)
const CASCADE_COLORS = ['#F59E0B', '#D97706', '#B45309', '#92400E', '#B45309', '#D97706', '#F59E0B', '#FCD34D'];

export class ThinkingSpinner {
  private intervalId: NodeJS.Timeout | null = null;
  private active = false;
  private displayChars: string[] = [];
  private charIndex = 0;
  private tick = 0;
  private phase: 'cascade' | 'ambient' = 'cascade';
  private ambientBrightness = 50;
  private ambientDir = 1;

  public start() {
    if (this.active) return;
    this.active = true;
    this.displayChars = [];
    this.charIndex = Math.floor(Math.random() * SANSKRIT_CHARS.length);
    this.tick = 0;
    this.phase = 'cascade';
    this.ambientBrightness = 50;

    this.intervalId = setInterval(() => {
      this.tick++;

      // Switch to ambient heartbeat after ~1.2s (15 ticks × 80ms)
      if (this.tick > 15 && this.phase === 'cascade') {
        this.phase = 'ambient';
      }

      if (this.phase === 'cascade') {
        // Add next Sanskrit char, keep max 8 visible (scrolling window)
        this.displayChars.push(SANSKRIT_CHARS[this.charIndex % SANSKRIT_CHARS.length]);
        this.charIndex++;
        if (this.displayChars.length > 8) this.displayChars.shift();

        // Render with warm gold gradient across the cascade
        let text = '  ';
        this.displayChars.forEach((char, i) => {
          text += chalk.hex(CASCADE_COLORS[i % CASCADE_COLORS.length])(char);
        });

        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(text);
      } else {
        // Ambient: single Sanskrit char pulsing between dim and bright warm orange
        this.ambientBrightness += this.ambientDir * 15;
        if (this.ambientBrightness >= 100) this.ambientDir = -1;
        if (this.ambientBrightness <= 10) this.ambientDir = 1;

        const bright = Math.max(10, Math.min(100, this.ambientBrightness));
        const r = Math.round(249 * bright / 100);
        const g = Math.round(115 * bright / 100);
        const b = Math.round(22 * bright / 100);
        const char = this.displayChars[this.displayChars.length - 1] || 'ॐ';
        const text = `  \u001b[38;2;${r};${g};${b}m${char}\u001b[0m`;

        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
        process.stdout.write(text);
      }
    }, 80);
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
    const cols = process.stdout.columns || 80;

    if (typeof stdin.setRawMode !== 'function') {
      // Non-TTY fallback
      console.log(`\n${themePrimary.bold(title)}`);
      console.log(themeBorder('─'.repeat(cols)));
      options.forEach((opt, idx) => console.log(`  ${themeGold('❯')} ${themeGray(opt)}`));
      resolve(0);
      return;
    }

    let selectedIndex = 0;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);
    stdout.write('\u001b[?25l'); // hide cursor

    const render = () => {
      stdout.write('\r\n' + themePrimary.bold(title) + '\r\n');
      stdout.write(themeBorder('─'.repeat(cols)) + '\r\n');
      options.forEach((opt, idx) => {
        if (idx === selectedIndex) {
          stdout.write(`  ${themeGold('❯')} ${chalk.hex('#E2E8F0').bold(opt)}\r\n`);
        } else {
          stdout.write(`    ${themeGray(opt)}\r\n`);
        }
      });
    };

    const clear = () => {
      const linesToMove = options.length + 3; // title + rule + options
      readline.moveCursor(stdout, 0, -linesToMove);
      readline.cursorTo(stdout, 0);
      readline.clearScreenDown(stdout);
    };

    render();

    const onKeypress = (str: any, key: any) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { cleanup(); process.exit(0); }
      if (key.name === 'escape' || key.name === 'q') { cleanup(); resolve(-1); }
      else if (key.name === 'up') { selectedIndex = (selectedIndex - 1 + options.length) % options.length; clear(); render(); }
      else if (key.name === 'down') { selectedIndex = (selectedIndex + 1) % options.length; clear(); render(); }
      else if (key.name === 'return' || key.name === 'enter') { cleanup(); resolve(selectedIndex); }
    };

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(wasRaw);
      stdout.write('\u001b[?25h'); // restore cursor
      clear();
    };

    stdin.on('keypress', onKeypress);
  });
}

// Setup marked renderer — Dark Ritual palette
const markedRenderer = markedTerminal({
  heading: (text: string) => themePrimary.bold(text),
  firstHeading: (text: string) => themePrimary.bold.underline(text),
  blockquote: chalk.hex('#64748B').italic,
  listitem: (text: string) => `${themeGold('·')} ${text}`,
  tableOptions: {
    style: {
      head: ['cyan'],
      border: ['gray']
    }
  },
  codespan: (text: string) => themeAccentLight.bgHex(themeBg)(' ' + text + ' '),
});

// Code block renderer — language label on top rule, dark bg body, bottom rule
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
    highlighted = themeAccentLight(text);
  }

  const cols = process.stdout.columns || 80;
  const ruleLen = Math.max(cols - 4, 20);

  // Top rule: language label in themePrimary, rule fills the rest
  const topRule = '  ' + (language
    ? themePrimary(language) + ' ' + themeBorder('─'.repeat(Math.max(ruleLen - language.length - 1, 0)))
    : themeBorder('─'.repeat(ruleLen)));

  const styledLines = highlighted.split('\n').map(line => {
    return `  ${line.replace(/\t/g, '    ')}`;
  });

  const bottomRule = '  ' + themeBorder('─'.repeat(ruleLen));

  return '\n' + topRule + '\n' + styledLines.join('\n') + '\n' + bottomRule + '\n\n';
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

// Unified diff renderer — replaces the old side-by-side layout
export function renderSideBySideDiff(original: string, modified: string, language: string, filePath: string) {
  const cols = Math.max(process.stdout.columns || 80, 40);
  const rule = '─'.repeat(cols - 2);

  const oldLines = original.split('\n');
  const newLines = modified.split('\n');
  const diff = diffLines(oldLines, newLines);

  console.log('\n' + themePrimary(path.basename(filePath)) + ' ' + themeGray('· modified'));
  console.log(themeBorder(rule));

  let oldLineNum = 1, newLineNum = 1;
  for (const entry of diff) {
    const numWidth = 4;
    if (entry.type === 'removed') {
      const n = oldLineNum.toString().padStart(numWidth, ' ');
      console.log(themeGray(n) + ' ' + chalk.hex('#F87171')('- ' + entry.text));
      oldLineNum++;
    } else if (entry.type === 'added') {
      const n = newLineNum.toString().padStart(numWidth, ' ');
      console.log(themeGray(n) + ' ' + chalk.hex('#34D399')('+ ' + entry.text));
      newLineNum++;
    } else {
      const n = newLineNum.toString().padStart(numWidth, ' ');
      console.log(themeGray(n + '   ' + entry.text));
      oldLineNum++;
      newLineNum++;
    }
  }

  console.log(themeBorder(rule) + '\n');
}

export function renderNewFileBlock(content: string, language: string, filePath: string) {
  const cols = Math.max(process.stdout.columns || 80, 40);
  const rule = '─'.repeat(cols - 2);

  let highlightedLines: string[] = [];
  try {
    highlightedLines = highlightCli(content, { language }).split('\n');
  } catch (e) {
    highlightedLines = content.split('\n').map(l => themeAccentLight(l));
  }
  const rawLines = content.split('\n');

  console.log('\n' + themePrimary(path.basename(filePath)) + ' ' + themeGray('· new file'));
  console.log(themeBorder(rule));

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = (i + 1).toString().padStart(4, ' ');
    const highlighted = (highlightedLines[i] || '').replace(/\t/g, '    ');
    console.log(themeGray(lineNum) + '   ' + highlighted);
  }

  console.log(themeBorder(rule) + '\n');
}

/**
 * The Monument — Unit01 welcome banner
 * ◈ mark → vertical line → spaced wordmark → metadata rule
 */
export function printWelcomeBanner(workspaceRoot: string, modelName: string, contextLimit: number, fileCount: number) {
  const ctxK = contextLimit >= 1000 ? `${Math.round(contextLimit / 1000)}k ctx` : `${contextLimit} ctx`;
  const metaParts = [modelName, ctxK, workspaceRoot, `${fileCount} files`].filter(Boolean);
  const meta = metaParts.join('  ·  ');

  console.log('');
  console.log(themePrimary('  █     █  █▄  █  █  ███████  ▄████▄    ██ '));
  console.log(themePrimary('  █     █  ███ █  █     █    ██    ██  ███ '));
  console.log(themePrimary('  █     █  █ ███  █     █    ██    ██   ██ '));
  console.log(themePrimary('  █     █  █  ██  █     █    ██    ██   ██ '));
  console.log(themePrimary('   █████   █   █  █     █     ▀████▀    ██ '));
  console.log('');
  console.log('  ' + themeGray(meta));
  console.log('');
}

/**
 * Prints a ◈ type · message system notification.
 * type: 'error' | 'warn' | 'guard' | 'info' | 'stop'
 */
export function printSystemMessage(type: 'error' | 'warn' | 'guard' | 'info' | 'stop', message: string) {
  const colorMap: Record<string, (s: string) => string> = {
    error: chalk.hex('#F87171'),
    stop:  chalk.hex('#F87171'),
    warn:  chalk.hex('#F59E0B'),
    guard: chalk.hex('#F59E0B'),
    info:  chalk.hex('#38BDF8'),
  };
  const col = colorMap[type] || themeGray;
  console.log(col(`  ◈ ${type}`) + themeGray('  ·  ') + col(message));
}

/**
 * Prints a tool result line using the standard ⎿  glyph.
 */
export function printToolResult(status: 'success' | 'failure' | 'skipped', message: string) {
  const col = status === 'success' ? themeAccent : (status === 'failure' ? themeRed : themeGray);
  console.log(themeGray('  ⎿  ') + col(message));
}

/**
 * Interactive prompt helper for file writes (Component #8).
 * Supports hotkeys and left/right navigation, clears screen on confirm/cancel.
 */
export function interactiveConfirmWrite(filePath: string, lineCount: number, actionVerb: 'write' | 'create' | 'modify'): Promise<'y' | 'n' | 'p'> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    const fileGlyph = ''; // Nerd Font file glyph
    const title = `  ${fileGlyph}  ${actionVerb}  ${filePath}  ·  ${lineCount} lines`;
    const titleLen = stripAnsi(title).length;
    const rule = '  ' + '─'.repeat(Math.max(titleLen - 2, 20));

    if (typeof stdin.setRawMode !== 'function') {
      // Non-TTY fallback
      console.log('\n' + title);
      console.log(themeBorder(rule));
      console.log('  [y] yes    [n] no    [p] preview diff');
      resolve('y');
      return;
    }

    const options = [
      { key: 'y', label: 'yes' },
      { key: 'n', label: 'no' },
      { key: 'p', label: 'preview diff' }
    ];
    let selectedIndex = 0;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);
    stdout.write('\u001b[?25l'); // hide cursor

    const render = () => {
      stdout.write('\r\n' + title + '\r\n');
      stdout.write(themeBorder(rule) + '\r\n');
      
      const optStrings = options.map((opt, idx) => {
        if (idx === selectedIndex) {
          return `${themeGold('[')}${chalk.hex('#E2E8F0').bold(opt.key)}${themeGold(']')} ${chalk.hex('#E2E8F0').bold(opt.label)}`;
        } else {
          return themeGray(`[${opt.key}] ${opt.label}`);
        }
      });
      stdout.write('  ' + optStrings.join('    ') + '\r\n');
    };

    const clear = () => {
      const linesToMove = 3; // title + rule + options
      readline.moveCursor(stdout, 0, -linesToMove);
      readline.cursorTo(stdout, 0);
      readline.clearScreenDown(stdout);
    };

    render();

    const onKeypress = (str: any, key: any) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }
      
      const inputChar = (str || '').toLowerCase();
      if (inputChar === 'y') {
        cleanup();
        resolve('y');
      } else if (inputChar === 'n') {
        cleanup();
        resolve('n');
      } else if (inputChar === 'p') {
        cleanup();
        resolve('p');
      } else if (key.name === 'left') {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        clear();
        render();
      } else if (key.name === 'right') {
        selectedIndex = (selectedIndex + 1) % options.length;
        clear();
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(options[selectedIndex].key as 'y' | 'n' | 'p');
      }
    };

    const cleanup = () => {
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(wasRaw);
      stdout.write('\u001b[?25h'); // restore cursor
      clear();
    };

    stdin.on('keypress', onKeypress);
  });
}

/**
 * Contained prompt input zone (Components #4, #5, #19).
 * Features live-updating inline autocomplete for slash commands, prompt symbol color pulse,
 * and clears structural rules from terminal history upon submission.
 */
export function interactivePrompt(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const cols = process.stdout.columns || 80;

    if (typeof stdin.setRawMode !== 'function') {
      const tempRl = readline.createInterface({
        input: stdin,
        output: stdout
      });
      tempRl.question(`  ❯ `, (answer) => {
        tempRl.close();
        resolve(answer);
      });
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);
    stdout.write('\u001b[?25l'); // hide cursor

    let currentInput = '';
    let cursorOffset = 0;
    let showPopup = true;
    let lastLinesPrinted = 0;
    
    // Prompt symbol color pulse state
    let isGold = true;
    const pulseTimer = setInterval(() => {
      isGold = !isGold;
      redraw();
    }, 600);

    const commands = [
      '/models', '/thinking', '/status', '/usage', '/sessions', 
      '/compact', '/clear', '/help', '/exit', '/quit', 
      '/files', '/reindex', '/export', '/preview', '/changes', 
      '/undo', '/search'
    ];

    const getPopupMatches = () => {
      if (!showPopup || !currentInput.startsWith('/')) return [];
      const query = currentInput.toLowerCase();
      const all = commands.filter(c => c.startsWith(query));
      
      const filtered: string[] = [];
      let currentLen = 6; // visual indent + border │
      for (const cmd of all) {
        const cmdLen = cmd.length + 4; // command name + space padding
        if (currentLen + cmdLen < cols - 5) {
          filtered.push(cmd);
          currentLen += cmdLen;
        } else {
          break;
        }
      }
      return filtered;
    };

    const redraw = () => {
      // Clear previously printed lines
      if (lastLinesPrinted > 0) {
        readline.moveCursor(stdout, 0, -(lastLinesPrinted - 2));
        readline.cursorTo(stdout, 0);
        readline.clearScreenDown(stdout);
      }

      const matches = getPopupMatches();
      const hasPopup = matches.length > 0;
      let lines = [];

      if (hasPopup) {
        // Line 1: Popup matches
        const styledMatches = matches.map(match => {
          const matchedPart = themeGold.bold(currentInput);
          const restPart = themePrimary(match.slice(currentInput.length));
          return matchedPart + restPart;
        }).join('    ');
        lines.push(`  ${themeBorder('│')} ${styledMatches}`);
      }

      // Border rule
      lines.push(themeBorder('─'.repeat(cols)));

      // Input line
      const promptSymbol = isGold ? themeGold('❯') : themePrimary('❯');
      lines.push(`  ${promptSymbol} ${currentInput}`);

      // Bottom rule
      lines.push(themeBorder('─'.repeat(cols)));

      // Print all lines
      stdout.write(lines.join('\r\n') + '\r\n');
      lastLinesPrinted = lines.length;

      // Position terminal cursor on the input line (which is the second line from bottom)
      readline.moveCursor(stdout, 0, -2);
      readline.cursorTo(stdout, 4 + cursorOffset);
      stdout.write('\u001b[?25h'); // show cursor
    };

    redraw();

    const onKeypress = (str: any, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }

      if (key && key.name === 'escape') {
        showPopup = false;
        redraw();
        return;
      }

      if (key && key.name === 'tab') {
        const matches = getPopupMatches();
        if (matches.length > 0) {
          currentInput = matches[0];
          cursorOffset = currentInput.length;
          redraw();
        }
        return;
      }

      if (key && (key.name === 'return' || key.name === 'enter')) {
        readline.moveCursor(stdout, 0, -1);
        cleanup();
        resolve(currentInput);
        return;
      }

      if (key && key.name === 'backspace') {
        if (cursorOffset > 0) {
          currentInput = currentInput.slice(0, cursorOffset - 1) + currentInput.slice(cursorOffset);
          cursorOffset--;
          showPopup = true;
          redraw();
        }
        return;
      }

      if (key && key.name === 'left') {
        if (cursorOffset > 0) {
          cursorOffset--;
          redraw();
        }
        return;
      }

      if (key && key.name === 'right') {
        if (cursorOffset < currentInput.length) {
          cursorOffset++;
          redraw();
        }
        return;
      }

      // Standard character input
      if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
        currentInput = currentInput.slice(0, cursorOffset) + str + currentInput.slice(cursorOffset);
        cursorOffset++;
        showPopup = true;
        redraw();
      }
    };

    const cleanup = () => {
      clearInterval(pulseTimer);
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(wasRaw);
      
      // Clear the prompt input zone completely from terminal
      if (lastLinesPrinted > 0) {
        readline.cursorTo(stdout, 0);
        readline.moveCursor(stdout, 0, -(lastLinesPrinted - 2));
        readline.clearScreenDown(stdout);
      }
      stdout.write('\u001b[?25h'); // restore cursor
    };

    stdin.on('keypress', onKeypress);
  });
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
