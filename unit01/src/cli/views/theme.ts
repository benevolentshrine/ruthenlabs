import chalk from 'chalk';
import { execSync } from 'child_process';

let cachedCols: number | null = null;

export function getCols(): number {
  if (cachedCols !== null) return cachedCols;
  
  if (process.stdout.columns) {
    cachedCols = process.stdout.columns;
    return cachedCols;
  }
  if (process.stderr.columns) {
    cachedCols = process.stderr.columns;
    return cachedCols;
  }
  
  try {
    const sizeStr = execSync('stty size < /dev/tty 2>/dev/null').toString().trim();
    const parts = sizeStr.split(/\s+/);
    if (parts.length === 2) {
      const cols = parseInt(parts[1], 10);
      if (!isNaN(cols) && cols > 0) {
        cachedCols = cols;
        return cachedCols;
      }
    }
  } catch (e) {}

  try {
    const colsStr = execSync('tput cols < /dev/tty 2>/dev/null').toString().trim();
    const cols = parseInt(colsStr, 10);
    if (!isNaN(cols) && cols > 0) {
      cachedCols = cols;
      return cachedCols;
    }
  } catch (e) {}
  
  return 80;
}

if (typeof process.stdout.on === 'function') {
  process.stdout.on('resize', () => {
    cachedCols = process.stdout.columns || null;
  });
}


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

export const isGui = process.argv.includes('--gui');

export function guiEmit(event: any) {
  console.log(`__GUI_EVENT__:${JSON.stringify(event)}`);
}

export function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function countVisualLines(text: string, cols: number): number {
  const lines = text.split('\n');
  let totalLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ');
    const clean = stripAnsi(line);
    const len = clean.length;
    if (len === 0) {
      totalLines += 1;
    } else {
      totalLines += Math.ceil(len / cols);
    }
  }
  return totalLines;
}

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
