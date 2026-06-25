import * as readline from 'readline';
import chalk from 'chalk';
import { themePrimary, themeGold, themeGray, isGui, guiEmit, stripAnsi, themeBg } from './views/theme.js';

/**
 * Startup buffer: captures keystrokes typed during initialization
 * so they aren't lost before the interactive prompt starts.
 */
let startupBuffer = '';
let startupListening = false;
const inputHistory: string[] = [];
const MAX_HISTORY = 50;

// Status bar state (set from index.ts via setPromptStatus)
let promptStatusModel = '';
let promptStatusContext = '';
let promptStatusBranch = '';

export function setPromptStatus(model: string, contextPct: string, branch: string) {
  promptStatusModel = model;
  promptStatusContext = contextPct;
  promptStatusBranch = branch;
}

export function startStartupBuffer() {
  if (startupListening) return;
  const stdin = process.stdin;
  if (typeof stdin.setRawMode !== 'function') return;
  
  startupListening = true;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  
  stdin.on('data', (data: Buffer) => {
    if (startupListening) {
      startupBuffer += data.toString();
    }
  });
  
  // Restore original raw mode after setup — the prompt will re-enter raw mode
  stdin.setRawMode(wasRaw);
}

export function consumeStartupBuffer(): string {
  startupListening = false;
  const buf = startupBuffer;
  startupBuffer = '';
  return buf;
}

/**
 * Contained prompt input zone (Components #4, #5, #19).
 * Features live-updating inline autocomplete for slash commands, prompt symbol color pulse,
 * and clears structural rules from terminal history upon submission.
 */
export function interactivePrompt(): Promise<string> {
  if (isGui) {
    return new Promise((resolve) => {
      guiEmit({ type: 'done' });
      process.stdin.resume();
      const onData = (data: Buffer) => {
        const text = data.toString().trim();
        if (text) {
          process.stdin.removeListener('data', onData);
          resolve(text);
        }
      };
      process.stdin.on('data', onData);
    });
  }
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
    let lastCursorLine = 0;     // where we left the cursor (index within lines), for clearance
    let historyIndex = -1;
    let selectedPopupIndex = 0;
    
    // Prompt symbol color pulse state
    let isGold = true;
    const pulseTimer = setInterval(() => {
      isGold = !isGold;
      redraw();
    }, 600);

    const commands = [
      { name: '/init', desc: 'workspace setup wizard' },
      { name: '/models', desc: 'switch the active model' },
      { name: '/thinking', desc: 'toggle reasoning blocks' },
      { name: '/personality', desc: 'switch conversation personality' },
      { name: '/status', desc: 'system info' },
      { name: '/usage', desc: 'context window usage' },
      { name: '/compact', desc: 'compress conversation context' },
      { name: '/search', desc: 'search codebase (BM25)' },
      { name: '/files', desc: 'list all indexed files' },
      { name: '/reindex', desc: 'rebuild code index' },
      { name: '/preview', desc: 'preview last file diff' },
      { name: '/undo', desc: 'revert last file write' },
      { name: '/changes', desc: 'view recent file changes' },
      { name: '/clear', desc: 'clear conversation history' },
      { name: '/sessions', desc: 'browse and resume sessions' },
      { name: '/export', desc: 'export current session' },
      { name: '/exit', desc: 'quit unit01' },
    ];

    const getPopupMatches = () => {
      if (!showPopup || !currentInput.startsWith('/')) return [];
      const query = currentInput.toLowerCase();
      const all = commands.filter(c => c.name.startsWith(query));
      // Limit to 15 items so it doesn't overflow the terminal
      return all.slice(0, 15);
    };

    const redraw = () => {
      // Clear previously printed lines — cursor is at lastCursorLine, go up to line 0
      if (lastLinesPrinted > 0) {
        readline.cursorTo(stdout, 0);
        readline.moveCursor(stdout, 0, -lastCursorLine);
        readline.clearScreenDown(stdout);
      }

      const matches = getPopupMatches();
      const hasPopup = matches.length > 0;
      let lines = [];

      if (hasPopup) {
        // Vertical popup: each command on its own line, selected highlighted
        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          const matchedPart = themeGold.bold(currentInput);
          const restPart = themePrimary(match.name.slice(currentInput.length));
          const desc = themeGray(match.desc);
          const cursor = i === selectedPopupIndex ? themeGold('❯') : ' ';
          lines.push(`  ${cursor} ${matchedPart}${restPart}  ${desc}`);
        }
      }

      // Input line (full-width background, wraps naturally when long)
      const promptSymbol = isGold ? themeGold('❯') : themePrimary('❯');
      const prefixAnsi = `  ${promptSymbol} `;
      const prefixLen = stripAnsi(prefixAnsi).length; // 4
      const inputPlain = currentInput || (hasPopup ? '' : themeGray('Type a message or  /  to see commands'));
      const fullPlainLen = prefixLen + stripAnsi(inputPlain).length;

      // Wrapped input lines + cursor position within them
      let inputLineCount: number;
      let cursorInputLine: number;  // 0-indexed from top of input block
      let cursorCol: number;       // column within that line

      if (fullPlainLen <= cols) {
        // Single line — no wrapping
        const content = prefixAnsi + inputPlain;
        const padded = content + ' '.repeat(cols - stripAnsi(content).length);
        lines.push(chalk.bgHex(themeBg)(padded));
        inputLineCount = 1;
        cursorInputLine = 0;
        cursorCol = prefixLen + cursorOffset;
      } else {
        // First line: prefix + as many input chars as fit
        const firstLineChars = cols - prefixLen;
        const firstRaw = inputPlain.slice(0, firstLineChars);
        const firstContent = prefixAnsi + firstRaw;
        const firstPadded = firstContent + ' '.repeat(cols - stripAnsi(firstContent).length);
        lines.push(chalk.bgHex(themeBg)(firstPadded));

        // Remaining wrapped lines
        let remaining = inputPlain.slice(firstLineChars);
        while (remaining.length > 0) {
          const chunk = remaining.slice(0, cols);
          const padded = chunk + ' '.repeat(cols - stripAnsi(chunk).length);
          lines.push(chalk.bgHex(themeBg)(padded));
          remaining = remaining.slice(cols);
        }

        inputLineCount = 1 + Math.ceil((stripAnsi(inputPlain).length - firstLineChars) / cols);

        // Compute cursor position among wrapped lines
        if (cursorOffset <= firstLineChars) {
          cursorInputLine = 0;
          cursorCol = prefixLen + cursorOffset;
        } else {
          const offsetInRemaining = cursorOffset - firstLineChars;
          cursorInputLine = 1 + Math.floor(offsetInRemaining / cols);
          cursorCol = offsetInRemaining % cols;
        }
      }

      // Status bar (1 line — always present for stable layout)
      const statusText = promptStatusModel
        ? `${promptStatusModel}  ${themeGray('·')}  ${promptStatusContext}  ${themeGray('·')}  ${promptStatusBranch}`
        : '';
      lines.push(`  ${themeGray(statusText)}`);

      // Print all lines
      stdout.write(lines.join('\r\n') + '\r\n');
      lastLinesPrinted = lines.length;

      // Position terminal cursor on the right wrapped line + column
      const popupLineCount = hasPopup ? matches.length : 0;
      const cursorLineIndex = popupLineCount + cursorInputLine;
      readline.moveCursor(stdout, 0, -(lastLinesPrinted - cursorLineIndex));
      readline.cursorTo(stdout, cursorCol);
      lastCursorLine = cursorLineIndex;
      stdout.write('\u001b[?25h'); // show cursor
    };

    redraw();

    const onKeypress = (str: any, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(0);
      }

      if (key && key.name === 'escape') {
        // Exit command mode: clear input and hide popup
        currentInput = '';
        cursorOffset = 0;
        showPopup = false;
        redraw();
        return;
      }

      if (key && key.name === 'tab') {
        const matches = getPopupMatches();
        if (matches.length > 0) {
          // Tab executes the selected command directly
          currentInput = matches[selectedPopupIndex >= matches.length ? 0 : selectedPopupIndex].name;
          cleanup();
          const trimmed = currentInput.trim();
          if (trimmed && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== trimmed)) {
            inputHistory.push(trimmed);
            if (inputHistory.length > MAX_HISTORY) inputHistory.shift();
          }
          resolve(currentInput);
          return;
        }
        return;
      }

      if (key && (key.name === 'return' || key.name === 'enter')) {
        // If popup is visible, Enter executes the selected command
        const matches = getPopupMatches();
        if (matches.length > 0) {
          currentInput = matches[selectedPopupIndex >= matches.length ? 0 : selectedPopupIndex].name;
        }
        cleanup();
        // Push to history (skip empty and duplicates)
        const trimmed = currentInput.trim();
        if (trimmed && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== trimmed)) {
          inputHistory.push(trimmed);
          if (inputHistory.length > MAX_HISTORY) inputHistory.shift();
        }
        resolve(currentInput);
        return;
      }

      if (key && key.name === 'up') {
        const matches = getPopupMatches();
        if (matches.length > 0) {
          // Navigate popup
          selectedPopupIndex = (selectedPopupIndex - 1 + matches.length) % matches.length;
          redraw();
          return;
        }
        // Fallback: navigate history
        if (inputHistory.length > 0 && historyIndex < inputHistory.length - 1) {
          historyIndex++;
          currentInput = inputHistory[inputHistory.length - 1 - historyIndex];
          cursorOffset = currentInput.length;
          showPopup = false;
          redraw();
        }
        return;
      }

      if (key && key.name === 'down') {
        const matches = getPopupMatches();
        if (matches.length > 0) {
          // Navigate popup
          selectedPopupIndex = (selectedPopupIndex + 1) % matches.length;
          redraw();
          return;
        }
        // Fallback: navigate history
        if (historyIndex > 0) {
          historyIndex--;
          currentInput = inputHistory[inputHistory.length - 1 - historyIndex];
          cursorOffset = currentInput.length;
          showPopup = false;
          redraw();
        } else if (historyIndex === 0) {
          historyIndex = -1;
          currentInput = '';
          cursorOffset = 0;
          showPopup = true;
          redraw();
        }
        return;
      }

      if (key && key.name === 'backspace') {
        if (cursorOffset > 0) {
          currentInput = currentInput.slice(0, cursorOffset - 1) + currentInput.slice(cursorOffset);
          cursorOffset--;
          selectedPopupIndex = 0;
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
        selectedPopupIndex = 0;
        showPopup = true;
        redraw();
      }
    };

    const cleanup = () => {
      clearInterval(pulseTimer);
      stdin.removeListener('keypress', onKeypress);
      stdin.setRawMode(wasRaw);
      
      // Clear the prompt input zone completely from terminal
      // Cursor is at lastCursorLine — go up to line 0, then clear everything down
      if (lastLinesPrinted > 0) {
        readline.cursorTo(stdout, 0);
        readline.moveCursor(stdout, 0, -lastCursorLine);
        readline.clearScreenDown(stdout);
      }
      stdout.write('\u001b[?25h'); // restore cursor
    };

    stdin.on('keypress', onKeypress);
  });
}
