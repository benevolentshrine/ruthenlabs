import * as path from 'path';
import chalk from 'chalk';
import { highlight as highlightCli } from 'cli-highlight';
import { themeBorder, themeGray, themePrimary, themeAccentLight } from './theme.js';

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
