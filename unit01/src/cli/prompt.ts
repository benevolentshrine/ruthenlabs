import * as readline from 'readline';
import { themePrimary, themeBorder, themeGold, themeGray, isGui, guiEmit } from './views/theme.js';

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

    if (typeof stdin.setRawMode !== 'function') {
      const tempRl = readline.createInterface({ input: stdin, output: stdout });
      tempRl.question(`  ❯ `, (answer) => { tempRl.close(); resolve(answer); });
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    readline.emitKeypressEvents(stdin);
    
    // Enable Bracketed Paste Mode
    stdout.write('\x1b[?2004h');
    stdout.write('\u001b[?25l'); // hide cursor

    let currentInput = '';
    let cursorOffset = 0;
    let showPopup = true;
    
    let lastPhysicalLines = 0;
    let topBorderDrawn = false;
    let currentCursorY = 0;
    let currentCursorX = 4;
    let currentInputVisualLines = 1;
    let currentHasPopup = false;
    let historyIndex = -1;

    let isPasting = false;
    let flashMessage = '';
    let flashTimer: NodeJS.Timeout | null = null;
    
    let isGold = true;
    const pulseTimer = setInterval(() => {
      isGold = !isGold;
      redraw();
    }, 600);

    const commands = [
      '/models', '/thinking', '/status', '/usage', '/sessions', 
      '/compact', '/clear', '/help', '/exit', '/quit', 
      '/files', '/reindex', '/export', '/preview', '/changes', 
      '/undo', '/search', '/connect', '/audit', '/autopilot', '/reset-password'
    ];

    const getPopupMatches = (cols: number) => {
      if (!showPopup || !currentInput.startsWith('/')) return [];
      const query = currentInput.toLowerCase();
      const all = commands.filter(c => c.startsWith(query));
      
      const filtered: string[] = [];
      let currentLen = 6; 
      for (const cmd of all) {
        const cmdLen = cmd.length + 4; 
        if (currentLen + cmdLen < cols - 5) {
          filtered.push(cmd);
          currentLen += cmdLen;
        } else {
          break;
        }
      }
      return filtered;
    };

    const clearPrompt = (newHasPopup: boolean) => {
      if (!topBorderDrawn) return;
      readline.cursorTo(stdout, 0);
      if (currentHasPopup || newHasPopup) {
        // Popup is or was visible — must go above the top border to clear the popup row
        const linesUp = currentCursorY + 2;
        if (linesUp > 0) readline.moveCursor(stdout, 0, -linesUp);
        readline.clearScreenDown(stdout);
      } else {
        // No popup — top border stays put, only clear from the first input line downward
        if (currentCursorY > 0) readline.moveCursor(stdout, 0, -currentCursorY);
        stdout.write('\x1b[2K'); // Explicitly erase the entire first input line
        readline.clearScreenDown(stdout);
      }
    };

    const getVisualPositionFromOffset = (offset: number, cols: number): { y: number, x: number } => {
      const SAFE_COLS = Math.max(20, cols - 1);
      const prefixLen = 4;
      const parts = currentInput.split('\n');
      let cursorY = -1;
      let cursorX = 4;
      let currentVisualLine = 0;
      let charIndex = 0;

      for (let i = 0; i < parts.length; i++) {
        const lineStr = parts[i];
        let remaining = lineStr;
        if (remaining.length === 0) {
          if (offset === charIndex) {
            cursorY = currentVisualLine;
            cursorX = prefixLen;
          }
          charIndex++; 
          currentVisualLine++;
          continue;
        }

        const available = SAFE_COLS - prefixLen;
        let firstChunk = true;
        while (remaining.length > 0) {
          const chunk = remaining.slice(0, available);
          
          if (cursorY === -1 && offset >= charIndex && offset <= charIndex + chunk.length) {
            if (offset < charIndex + chunk.length || chunk.length < available) {
              cursorY = currentVisualLine;
              cursorX = prefixLen + (offset - charIndex);
            }
          }
          
          charIndex += chunk.length;
          remaining = remaining.slice(available);
          firstChunk = false;
          currentVisualLine++;
        }
        charIndex++; 
      }
      
      if (cursorY === -1) {
        cursorY = Math.max(0, currentVisualLine - 1);
        cursorX = prefixLen;
      }
      return { y: cursorY, x: cursorX };
    };

    const getOffsetFromVisualPosition = (targetY: number, targetX: number, cols: number): number => {
      let bestOffset = 0;
      let minDistance = Infinity;
      let foundY = false;

      for (let offset = 0; offset <= currentInput.length; offset++) {
        const pos = getVisualPositionFromOffset(offset, cols);
        if (pos.y === targetY) {
          foundY = true;
          const dist = Math.abs(pos.x - targetX);
          if (dist < minDistance) {
            minDistance = dist;
            bestOffset = offset;
          }
        }
      }

      if (!foundY) {
        if (targetY < 0) return 0;
        return currentInput.length;
      }
      return bestOffset;
    };

    const redraw = () => {
      stdout.write('\u001b[?25l'); // hide cursor
      const cols = process.stdout.columns || 80;
      const SAFE_COLS = Math.max(20, cols - 1); // Strictly prevent terminal auto-wrap

      // Compute popup state BEFORE clearPrompt — we need it to decide how far up to clear
      const matches = getPopupMatches(cols);
      const hasPopup = matches.length > 0;
      const prevHasPopup = currentHasPopup;

      clearPrompt(hasPopup);

      currentHasPopup = hasPopup;

      const lines = [];

      // Top border is drawn once on first render, then only redrawn when popup is/was
      // involved (popup lives above the top border, forcing a full block redraw).
      // All other redraws skip the top border entirely — it stays anchored in place.
      const needsTopBorder = !topBorderDrawn || hasPopup || prevHasPopup;

      if (hasPopup) {
        const styledMatches = matches.map(match => {
          const matchedPart = themeGold.bold(currentInput);
          const restPart = themePrimary(match.slice(currentInput.length));
          return matchedPart + restPart;
        }).join('    ');
        lines.push(`  ${themeBorder('│')} ${styledMatches}`);
      }

      if (needsTopBorder) {
        lines.push(themeBorder('─'.repeat(SAFE_COLS)));
        topBorderDrawn = true;
      }

      const promptSymbol = isGold ? themeGold('❯') : themePrimary('❯');
      const prefixStr = `  ${promptSymbol} `;
      const prefixLen = 4;
      
      const inputDisplayLines: string[] = [];
      let cursorY = -1;
      let cursorX = 4;
      
      const parts = currentInput.split('\n');
      let currentVisualLine = 0;
      let charIndex = 0;

      // Hard-chunk the input string to guarantee visual line mapping
      for (let i = 0; i < parts.length; i++) {
        const lineStr = parts[i];
        const prefix = i === 0 ? prefixStr : '    ';
        
        let remaining = lineStr;
        if (remaining.length === 0) {
          inputDisplayLines.push(prefix);
          if (cursorOffset === charIndex) {
            cursorY = currentVisualLine;
            cursorX = prefixLen;
          }
          charIndex++; 
          currentVisualLine++;
          continue;
        }

        let firstChunk = true;
        while (remaining.length > 0) {
          const available = SAFE_COLS - prefixLen;
          const chunk = remaining.slice(0, available);
          
          inputDisplayLines.push((firstChunk ? prefix : '    ') + chunk);
          
          if (cursorY === -1 && cursorOffset >= charIndex && cursorOffset <= charIndex + chunk.length) {
            // Lock cursor if inside chunk, or if at exact boundary and nothing remains
            if (cursorOffset < charIndex + chunk.length || chunk.length < available) {
              cursorY = currentVisualLine;
              cursorX = prefixLen + (cursorOffset - charIndex);
            }
          }
          
          charIndex += chunk.length;
          remaining = remaining.slice(available);
          firstChunk = false;
          currentVisualLine++;
        }
        charIndex++; 
      }
      
      // Failsafe: if cursor perfectly hits the exact right margin boundary
      if (cursorY === -1) {
        inputDisplayLines.push('    ');
        cursorY = currentVisualLine;
        cursorX = prefixLen;
        currentVisualLine++;
      }

      currentCursorY = cursorY;
      currentCursorX = cursorX;
      currentInputVisualLines = inputDisplayLines.length;

      lines.push(...inputDisplayLines);
      lines.push(themeBorder('─'.repeat(SAFE_COLS)));

      if (flashMessage) {
        lines.push(`  ${themeGray.italic(flashMessage)}`);
      }

      const statusText = promptStatusModel
        ? `${promptStatusModel}  ${themeGray('·')}  ${promptStatusContext}  ${themeGray('·')}  ${promptStatusBranch}`
        : '';
      if (statusText) {
        lines.push(`  ${themeGray(statusText)}`);
      }

      lastPhysicalLines = (hasPopup ? 1 : 0) + 1 + inputDisplayLines.length + 1 + (flashMessage ? 1 : 0) + (statusText ? 1 : 0);

      // Do NOT append trailing \r\n to prevent unintended bottom-scrolling
      stdout.write(lines.join('\r\n'));

      // Move cursor UP from the bottom of the printed block to the exact input position
      const moveUp = inputDisplayLines.length - 1 - cursorY + 1 + (flashMessage ? 1 : 0) + (statusText ? 1 : 0);
      if (moveUp > 0) {
        readline.moveCursor(stdout, 0, -moveUp);
      }
      readline.cursorTo(stdout, cursorX);
      stdout.write('\u001b[?25h'); 
    };

    redraw();

    const rejectPaste = () => {
      flashMessage = `  Pasting is disabled — use "@filename" to include files`;
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flashMessage = '';
        redraw();
      }, 3500);
      redraw();
    };


    const onData = (data: Buffer) => {
      const str = data.toString('utf-8');

      // Bracketed paste start detected — show rejection message
      if (str.includes('\x1b[200~')) {
        rejectPaste();
        return;
      }
      // Draining remaining paste data — discard silently.
      // isPasting lifecycle is managed entirely by prependListener
      // (which runs first) using process.nextTick, so that readline's
      // keypress emitter (which runs third) always sees isPasting = true.
      if (isPasting) {
        return;
      }
    };

    stdin.on('data', onData);

    // Paste guard: must be prependListener so it runs BEFORE readline's keypress emitter
    // (which was registered via emitKeypressEvents at startup). If we don't intercept
    // first, readline emits individual keypress events for every pasted character before
    // onData even sees the data, and onKeypress happily accepts them all (isPasting=false).
    stdin.prependListener('data', (data: Buffer) => {
      const str = data.toString('utf-8');
      const isBracketedPaste = str.includes('\x1b[200~');
      // Non-bracketed paste: multiple code points arriving in one data event.
      // Normal single keystrokes always arrive as exactly one code point per event.
      const isNonBracketedPaste = !isBracketedPaste && !str.startsWith('\x1b') && [...str].length > 1;

      if (isBracketedPaste || isNonBracketedPaste) {
        isPasting = true;
        // Reset on next tick so readline's synchronous keypress emission
        // (which runs after both data listeners) sees isPasting = true
        // and discards every pasted character. Without this delay, onData
        // would reset isPasting before readline ever gets to process the
        // data, and every pasted character would leak through into currentInput.
        process.nextTick(() => {
          isPasting = false;
          if (isNonBracketedPaste) {
            // Non-bracketed paste has no \x1b[201~ end marker to trigger
            // rejectPaste in onData, so show the flash message here.
            rejectPaste();
          }
        });
      }
    });

    const onKeypress = (str: any, key: any) => {
      if (isPasting) return;

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
        const matches = getPopupMatches(process.stdout.columns || 80);
        if (matches.length > 0) {
          currentInput = matches[0];
          cursorOffset = currentInput.length;
          redraw();
        }
        return;
      }

      if (key && (key.name === 'return' || key.name === 'enter')) {
        cleanup();
        const trimmed = currentInput.trim();
        if (trimmed && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== trimmed)) {
          inputHistory.push(trimmed);
          if (inputHistory.length > MAX_HISTORY) inputHistory.shift();
        }
        resolve(currentInput);
        return;
      }

      if (key && key.name === 'up') {
        if (currentCursorY > 0) {
          const cols = process.stdout.columns || 80;
          cursorOffset = getOffsetFromVisualPosition(currentCursorY - 1, currentCursorX, cols);
          redraw();
          return;
        }
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
        if (currentCursorY < currentInputVisualLines - 1) {
          const cols = process.stdout.columns || 80;
          cursorOffset = getOffsetFromVisualPosition(currentCursorY + 1, currentCursorX, cols);
          redraw();
          return;
        }
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

      if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
        currentInput = currentInput.slice(0, cursorOffset) + str + currentInput.slice(cursorOffset);
        cursorOffset++;
        showPopup = true;
        redraw();
      }
    };

    const cleanup = () => {
      clearInterval(pulseTimer);
      if (flashTimer) clearTimeout(flashTimer);
      
      stdin.removeListener('data', onData);
      stdin.removeListener('keypress', onKeypress);
      
      // Full clear on exit — erase everything including the static top border
      readline.cursorTo(stdout, 0);
      readline.moveCursor(stdout, 0, -(currentCursorY + (currentHasPopup ? 2 : 1)));
      readline.clearScreenDown(stdout);
      
      // Disable Bracketed Paste Mode
      stdout.write('\x1b[?2004l');
      
      stdin.setRawMode(wasRaw);
      stdout.write('\u001b[?25h'); // restore cursor
    };

    stdin.on('keypress', onKeypress);
  });
}
