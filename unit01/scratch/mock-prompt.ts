import * as readline from 'readline';
import chalk from 'chalk';
import { execSync } from 'child_process';

// Terminal colors
const themePrimary = chalk.hex('#A78BFA'); // Lavender Accent
const themeGray = chalk.hex('#64748B');    // Slate 500

// Mock Paste Database
const pasteMap = new Map<number, string>();
let pasteCount = 0;

// Get actual terminal columns (even under Bun redirect)
function getTerminalCols(): number {
  try {
    const size = execSync('stty size < /dev/tty', { stdio: ['inherit', 'pipe', 'pipe'] }).toString().trim();
    const cols = parseInt(size.split(' ')[1], 10);
    return cols || 80;
  } catch {
    return process.stdout.columns || 80;
  }
}

// Strip ANSI control sequences to calculate exact text lengths
function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

// Calculate the number of terminal lines a string takes up when wrapped
function countVisualLines(text: string, cols: number): number {
  const lines = text.split('\n');
  let visualTotal = 0;
  for (const line of lines) {
    const clean = stripAnsi(line);
    visualTotal += Math.max(1, Math.ceil(clean.length / cols));
  }
  return visualTotal;
}

// Format byte sizes cleanly
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Re-inject the real paste content back into the prompt string before returning it
function expandPastedText(inputStr: string): string {
  const expanded = inputStr.replace(/\[Pasted text #(\d+) \(\d+ lines, [^)]+\)\]/g, (match, idStr) => {
    const id = parseInt(idStr, 10);
    return pasteMap.get(id) || match;
  });
  return expanded.replace(/\r+\n/g, '\n').replace(/\r/g, '\n');
}

// Main interactive test loop
async function runMockPrompt(): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (typeof stdin.setRawMode !== 'function') {
    console.log('Error: Raw mode is not supported in this terminal.');
    process.exit(1);
  }

  // Restore raw mode on exit
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();

  stdout.write('\u001b[?25l');  // Hide default block cursor
  stdout.write('\u001b[?2004h'); // Enable terminal Bracketed Paste Mode

  let currentInput = '';
  let cursorOffset = 0;
  let lastLinesPrinted = 0;
  let lastLinesAboveCursor = 0;

  let isBracketedPasting = false;
  let pasteBuffer = '';

  // Redraw the terminal input area
  const redraw = () => {
    const cols = getTerminalCols();

    // 1. Format the display input (Highlight paste blocks)
    let displayInput = currentInput.replace(/\[Pasted text #\d+ \(\d+ lines, [^)]+\)\]/g, (match) => {
      return chalk.bgHex('#1E293B').hex('#E2E8F0').bold(` ${match} `);
    });

    const prefix = `  ❯ `;
    const cleanPrefix = stripAnsi(prefix);
    const cleanDisplay = stripAnsi(displayInput);
    const totalLines = countVisualLines(prefix + cleanDisplay, cols);

    // Calculate cursor position inside the wrapped lines
    const textBeforeCursor = currentInput.slice(0, cursorOffset);
    // Approximate length including bracket visual markers
    const cleanBeforeCursor = stripAnsi(textBeforeCursor.replace(/\[Pasted text #\d+ \(\d+ lines, [^)]+\)\]/g, '[$&]'));
    const totalCharsBeforeCursor = cleanPrefix.length + cleanBeforeCursor.length;
    
    const cursorY = Math.floor(totalCharsBeforeCursor / cols);
    const cursorX = totalCharsBeforeCursor % cols;

    // A. CLEAR OLD PRINTED AREA (Line-by-line traversal going up)
    if (lastLinesPrinted > 0) {
      // First, traverse down from active cursor to the bottom line of the last print
      const linesToMoveDown = lastLinesPrinted - 1 - lastLinesAboveCursor;
      if (linesToMoveDown > 0) {
        stdout.write(`\u001b[${linesToMoveDown}B`);
      }
      
      // Move up line-by-line, clearing each row to avoid clearScreenDown scroll issues
      for (let i = 0; i < lastLinesPrinted; i++) {
        stdout.write('\r\u001b[2K'); // Move to col 0 + clear line
        if (i < lastLinesPrinted - 1) {
          stdout.write('\u001b[1A'); // Move cursor up 1 line
        }
      }
    }

    // B. DRAW THE NEW PROMPT
    stdout.write(prefix + displayInput);

    // C. POSITION THE CURSOR (Relative to the end of the printed prompt)
    const linesAfterCursor = totalLines - 1 - cursorY;
    if (linesAfterCursor > 0) {
      stdout.write(`\u001b[${linesAfterCursor}A`);
    }
    readline.cursorTo(stdout, cursorX);

    // Save state for next redraw
    lastLinesPrinted = totalLines;
    lastLinesAboveCursor = cursorY;
  };

  // Pulse Alert cursor state indicator
  let isPulseGold = true;
  const cursorPulse = setInterval(() => {
    isPulseGold = !isPulseGold;
    redraw();
  }, 500);

  return new Promise<string>((resolve) => {
    const cleanup = () => {
      clearInterval(cursorPulse);
      stdin.removeListener('data', onData);
      stdout.write('\u001b[?25h');  // Restore default cursor
      stdout.write('\u001b[?2004l'); // Disable Bracketed Paste Mode
      stdin.setRawMode(wasRaw);
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();

      // Bracketed Paste detection
      if (text.includes('\u001b[200~')) {
        isBracketedPasting = true;
        pasteBuffer = '';
      }

      if (isBracketedPasting) {
        let cleanText = text.replace('\u001b[200~', '');
        const hasEnd = cleanText.includes('\u001b[201~');
        if (hasEnd) {
          cleanText = cleanText.replace('\u001b[201~', '');
        }
        pasteBuffer += cleanText;

        if (hasEnd) {
          isBracketedPasting = false;
          const hasNewlines = pasteBuffer.includes('\n') || pasteBuffer.includes('\r');
          if (hasNewlines) {
            const lines = pasteBuffer.split(/\r?\n|\r/).length;
            const sizeStr = formatSize(pasteBuffer.length);
            pasteCount++;
            pasteMap.set(pasteCount, pasteBuffer);
            const token = `[Pasted text #${pasteCount} (${lines} lines, ${sizeStr})]`;
            currentInput = currentInput.slice(0, cursorOffset) + token + currentInput.slice(cursorOffset);
            cursorOffset += token.length;
          } else {
            currentInput = currentInput.slice(0, cursorOffset) + pasteBuffer + currentInput.slice(cursorOffset);
            cursorOffset += pasteBuffer.length;
          }
          pasteBuffer = '';
          redraw();
        }
        return;
      }

      // Check for non-bracketed fallback copy-paste (long inputs in a single chunk)
      const isKeypress = chunk.length === 1 || text.startsWith('\u001b') || text === '\r\n';
      const hasNewlines = text.includes('\n') || text.includes('\r');
      const isFallbackPaste = !isKeypress && (chunk.length > 15 || hasNewlines);

      if (isFallbackPaste) {
        if (hasNewlines) {
          const lines = text.split(/\r?\n|\r/).length;
          const sizeStr = formatSize(text.length);
          pasteCount++;
          pasteMap.set(pasteCount, text);
          const token = `[Pasted text #${pasteCount} (${lines} lines, ${sizeStr})]`;
          currentInput = currentInput.slice(0, cursorOffset) + token + currentInput.slice(cursorOffset);
          cursorOffset += token.length;
        } else {
          currentInput = currentInput.slice(0, cursorOffset) + text + currentInput.slice(cursorOffset);
          cursorOffset += text.length;
        }
        redraw();
        return;
      }

      // Handle individual keys
      // Ctrl+C (Exit)
      if (text === '\u0003') {
        cleanup();
        console.log('\n\n  Exit code 0');
        process.exit(0);
      }

      // Enter key
      if (text === '\r' || text === '\n') {
        cleanup();
        const resolved = expandPastedText(currentInput);
        resolve(resolved);
        return;
      }

      // Backspace
      if (text === '\u007f') {
        if (cursorOffset > 0) {
          const sliceBefore = currentInput.slice(0, cursorOffset);
          const pasteMatch = sliceBefore.match(/\[Pasted text #\d+ \(\d+ lines, [^)]+\)\]$/);
          if (pasteMatch) {
            const tokenLen = pasteMatch[0].length;
            currentInput = currentInput.slice(0, cursorOffset - tokenLen) + currentInput.slice(cursorOffset);
            cursorOffset -= tokenLen;
          } else {
            currentInput = currentInput.slice(0, cursorOffset - 1) + currentInput.slice(cursorOffset);
            cursorOffset--;
          }
        }
        redraw();
        return;
      }

      // Arrow keys / Standard Typing
      if (chunk.length === 1 && text >= ' ') {
        currentInput = currentInput.slice(0, cursorOffset) + text + currentInput.slice(cursorOffset);
        cursorOffset++;
        redraw();
      }
    };

    stdin.on('data', onData);
    redraw();
  });
}

// Test Runner for our Mock CLI
async function runTest() {
  console.log(chalk.bold.magenta('\n=== Unit01 CLI Multiline & Paste Mock Simulator ==='));
  console.log(chalk.gray('Info: Try typing, copy-pasting a long block of code/text, and hit Enter.\nPress Ctrl+C to abort at any time.\n'));
  
  const result = await runMockPrompt();
  
  console.log(chalk.bold.green('\n\n=== Resolved User Prompt Output ==='));
  console.log(chalk.yellow(result));
  console.log(chalk.gray(`\nTotal resolved string length: ${result.length} characters.`));
}

runTest();
