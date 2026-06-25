import * as readline from 'readline';
import * as path from 'path';
import chalk from 'chalk';
import {
  themePrimary,
  themeBorder,
  themeGold,
  themeOrange,
  themeAccent,
  themeAccentLight,
  themeGray,
  themeRed,
  isGui,
  guiEmit,
  stripAnsi,
  getCols
} from './theme.js';

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
  if (isGui) {
    return new Promise((resolve) => {
      guiEmit({ type: 'interactive-select', title, options });
      process.stdin.resume();
      const onData = (data: Buffer) => {
        const text = data.toString().trim();
        const num = parseInt(text, 10);
        if (!isNaN(num) && num >= 0 && num < options.length) {
          process.stdin.removeListener('data', onData);
          resolve(num);
        }
      };
      process.stdin.on('data', onData);
    });
  }

  // Flush stdin backlog
  try {
    const stdin = process.stdin;
    if (typeof stdin.setRawMode === 'function') {
      const wasRaw = stdin.isRaw;
      stdin.setRawMode(true);
      while (stdin.read() !== null) {}
      stdin.setRawMode(wasRaw);
    }
  } catch (e) {}

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const cols = getCols();

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

    const startTime = Date.now();
    const onKeypress = (str: any, key: any) => {
      if (Date.now() - startTime < 100) return;
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

/**
 * Interactive prompt helper for file writes (Component #8).
 * Supports hotkeys and left/right navigation, clears screen on confirm/cancel.
 */
export function interactiveConfirmWrite(filePath: string, lineCount: number, actionVerb: 'write' | 'create' | 'modify'): Promise<'y' | 'n' | 'p'> {
  if (isGui) {
    return new Promise((resolve) => {
      guiEmit({ type: 'confirm-write', filePath, lineCount, action: actionVerb });
      process.stdin.resume();
      const onData = (data: Buffer) => {
        const text = data.toString().trim().toLowerCase();
        if (text === 'y' || text === 'yes') {
          process.stdin.removeListener('data', onData);
          resolve('y');
        } else if (text === 'n' || text === 'no') {
          process.stdin.removeListener('data', onData);
          resolve('n');
        } else if (text === 'p' || text === 'preview') {
          process.stdin.removeListener('data', onData);
          resolve('p');
        }
      };
      process.stdin.on('data', onData);
    });
  }
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

    const startTime = Date.now();
    const onKeypress = (str: any, key: any) => {
      if (Date.now() - startTime < 100) return;
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
 * The Monument — Unit01 welcome banner
 */
export function printWelcomeBanner(workspaceRoot: string, modelName: string, contextLimit: number, fileCount: number) {
  if (isGui) {
    guiEmit({
      type: 'init',
      workspaceRoot,
      modelName,
      contextLimit,
      fileCount
    });
    return;
  }

  console.log('');
  console.log(themePrimary('  █     █  █▄  █  █  ███████  ▄████▄    ██ '));
  console.log(themePrimary('  █     █  ███ █  █     █    ██    ██  ███ '));
  console.log(themePrimary('  █     █  █ ███  █     █    ██    ██   ██ '));
  console.log(themePrimary('  █     █  █  ██  █     █    ██    ██   ██ '));
  console.log(themePrimary('   █████   █   █  █     █     ▀████▀    ██ '));
  console.log('');
}

/**
 * Prints a ◈ type · message system notification.
 * type: 'error' | 'warn' | 'guard' | 'info' | 'stop'
 */
export function printSystemMessage(type: 'error' | 'warn' | 'guard' | 'info' | 'stop', message: string) {
  if (isGui) {
    guiEmit({ type: 'system-message', status: type, message });
    return;
  }
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
  if (isGui) {
    guiEmit({ type: 'tool-result', status, message });
    return;
  }
  const col = status === 'success' ? themeAccent : (status === 'failure' ? themeRed : themeGray);
  console.log(themeGray('  ⎿  ') + col(message));
}
