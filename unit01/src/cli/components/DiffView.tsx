import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import * as path from 'path';
import { highlight as highlightCli } from 'cli-highlight';
import {
  themePrimary,
  themeBorder,
  themeAccentLight,
  themeGray,
} from '../views/theme.js';

interface DiffViewProps {
  original: string | null;
  modified: string;
  language: string;
  filePath: string;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

interface Hunk {
  startLine: number;
  endLine: number;
  lines: DiffLine[];
  originalLinesOffset: number;
  newLinesOffset: number;
}

// Optimized Myers Diff Algorithm (O(ND) time/space)
function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const N = oldLines.length;
  const M = newLines.length;
  
  if (N === 0) return newLines.map(l => ({ type: 'added', text: l }));
  if (M === 0) return oldLines.map(l => ({ type: 'removed', text: l }));

  const max = N + M;
  const v: Record<number, number> = { 1: 0 };
  const trace: Record<number, number>[] = [];

  let x = 0;
  let y = 0;
  let found = false;

  for (let d = 0; d <= max; d++) {
    trace.push({ ...v });
    for (let k = -d; k <= d; k += 2) {
      if (k === -d || (k !== d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) {
        x = v[k + 1] ?? 0;
      } else {
        x = (v[k - 1] ?? 0) + 1;
      }
      y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[k] = x;
      if (x >= N && y >= M) {
        found = true;
        break;
      }
    }
    if (found) break;
  }

  const diff: DiffLine[] = [];
  x = N;
  y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK = k;
    if (k === -d || (k !== d && (vPrev[k - 1] ?? 0) < (vPrev[k + 1] ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[prevK] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      diff.unshift({ type: 'unchanged', text: oldLines[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x > prevX) {
        diff.unshift({ type: 'removed', text: oldLines[x - 1] });
        x--;
      } else if (y > prevY) {
        diff.unshift({ type: 'added', text: newLines[y - 1] });
        y--;
      }
    }
  }

  return diff;
}

// Group contiguous diff modifications with 3 lines of surrounding context
function buildHunks(diff: DiffLine[]): Hunk[] {
  const contextSize = 3;
  const visible = new Set<number>();

  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type === 'added' || diff[i].type === 'removed') {
      for (let j = Math.max(0, i - contextSize); j <= Math.min(diff.length - 1, i + contextSize); j++) {
        visible.add(j);
      }
    }
  }

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let oldLineCounter = 0;
  let newLineCounter = 0;

  for (let i = 0; i < diff.length; i++) {
    const line = diff[i];
    const oldNum = oldLineCounter + (line.type !== 'added' ? 1 : 0);
    const newNum = newLineCounter + (line.type !== 'removed' ? 1 : 0);

    if (visible.has(i)) {
      if (!currentHunk) {
        currentHunk = {
          startLine: Math.max(oldNum, newNum),
          endLine: 0,
          lines: [],
          originalLinesOffset: oldLineCounter,
          newLinesOffset: newLineCounter
        };
        hunks.push(currentHunk);
      }
      currentHunk.lines.push(line);
    } else {
      currentHunk = null;
    }

    if (line.type !== 'added') oldLineCounter++;
    if (line.type !== 'removed') newLineCounter++;
  }

  for (const hunk of hunks) {
    let oldOffset = hunk.originalLinesOffset;
    let newOffset = hunk.newLinesOffset;
    for (const line of hunk.lines) {
      if (line.type !== 'added') oldOffset++;
      if (line.type !== 'removed') newOffset++;
    }
    hunk.endLine = Math.max(oldOffset, newOffset);
  }

  return hunks;
}

function ModifiedFileView({
  filePath,
  original,
  modified,
  width,
}: {
  filePath: string;
  original: string;
  modified: string;
  width: number;
}): React.ReactElement {
  const diff = useMemo(
    () => diffLines(original.split('\n'), modified.split('\n')),
    [original, modified]
  );

  const hunks = useMemo(() => buildHunks(diff), [diff]);

  const ruleWidth = Math.max(width - 4, 40);
  const rule = '─'.repeat(ruleWidth);
  const baseName = path.basename(filePath);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="#E2E8F0" bold>{baseName}</Text>
        <Text color="#64748B"> · modified</Text>
      </Text>
      <Text color="#475569">{rule}</Text>
      {hunks.length === 0 ? (
        <Text color="#64748B">  No visible changes.</Text>
      ) : (
        hunks.map((hunk, hIdx) => {
          let oldLineNum = hunk.originalLinesOffset;
          let newLineNum = hunk.newLinesOffset;

          return (
            <Box key={hIdx} flexDirection="column">
              {hIdx > 0 && <Text color="#475569">  ···</Text>}
              <Text color="#475569">  @@ L{hunk.startLine}-{hunk.endLine} @@</Text>
              {hunk.lines.map((line, lIdx) => {
                if (line.type === 'removed') {
                  oldLineNum++;
                  const ln = String(oldLineNum).padStart(4);
                  return (
                    <Text key={lIdx}>
                      <Text color="#64748B">{ln} </Text>
                      <Text color="#F87171">- {line.text}</Text>
                    </Text>
                  );
                }
                if (line.type === 'added') {
                  newLineNum++;
                  const ln = String(newLineNum).padStart(4);
                  return (
                    <Text key={lIdx}>
                      <Text color="#64748B">{ln} </Text>
                      <Text color="#34D399">+ {line.text}</Text>
                    </Text>
                  );
                }
                // unchanged
                oldLineNum++;
                newLineNum++;
                const ln = String(newLineNum).padStart(4);
                return (
                  <Text key={lIdx}>
                    <Text color="#64748B">{ln} </Text>
                    <Text>   {line.text}</Text>
                  </Text>
                );
              })}
            </Box>
          );
        })
      )}
      <Text color="#475569">{rule}</Text>
    </Box>
  );
}

function NewFileView({
  filePath,
  modified,
  language,
  width,
}: {
  filePath: string;
  modified: string;
  language: string;
  width: number;
}): React.ReactElement {
  const ruleWidth = Math.max(width - 4, 40);
  const rule = '─'.repeat(ruleWidth);
  const baseName = path.basename(filePath);

  let highlighted = modified;
  try {
    highlighted = highlightCli(modified, { language });
  } catch {
    highlighted = themeAccentLight(modified);
  }

  const lines = highlighted.split('\n');

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="#E2E8F0" bold>{baseName}</Text>
        <Text color="#64748B"> · new file</Text>
      </Text>
      <Text color="#475569">{rule}</Text>
      {lines.map((line, i) => {
        const ln = String(i + 1).padStart(4);
        return (
          <Text key={`n${i}`}>
            <Text color="#64748B">{ln} </Text>
            <Text>{line}</Text>
          </Text>
        );
      })}
      <Text color="#475569">{rule}</Text>
    </Box>
  );
}

export function DiffView({ original, modified, language, filePath }: DiffViewProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  if (original !== null) {
    return (
      <ModifiedFileView
        filePath={filePath}
        original={original}
        modified={modified}
        width={width}
      />
    );
  }

  return (
    <NewFileView
      filePath={filePath}
      modified={modified}
      language={language}
      width={width}
    />
  );
}
