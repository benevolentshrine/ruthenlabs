import * as readline from 'readline';
import { themePrimary, themeBorder, themeGold, isGui, guiEmit } from './views/theme.js';

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
      '/undo', '/search', '/connect'
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
