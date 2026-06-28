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


// Theme: Unified Cool Slate & Cyan Accent
export const themePrimary     = chalk.hex('#F1F5F9'); // Primary Text
export const themeBorder      = chalk.hex('#334155'); // Section Dividers & borders
export const themeGold        = chalk.hex('#38BDF8'); // Sky Blue Accent (replaces amber cursor/selections)
export const themeOrange      = chalk.hex('#38BDF8'); // backward compat alias
export const themeAccent      = chalk.hex('#4ADE80'); // Tool success / status messages
export const themeAccentLight = chalk.hex('#38BDF8'); // Inline code / Light accent
export const themeGray        = chalk.hex('#475569'); // Secondary text
export const themeRed         = chalk.hex('#F87171'); // Errors / failures
export const themeBg          = '#1E293B';            // Base Slate
export const themeBgDeep      = '#0F172A';            // Dark Slate


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
