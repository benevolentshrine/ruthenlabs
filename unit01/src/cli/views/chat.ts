import chalk from 'chalk';
import { marked } from 'marked';
// @ts-ignore
import { markedTerminal } from 'marked-terminal';
import { highlight as highlightCli } from 'cli-highlight';
import { themePrimary, themeBorder, themeGold, themeAccentLight, themeGray, themeBg } from './theme.js';

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

export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown) as string;
}

// Note: This function contains a hardcoded list of tool tag names that must be kept in sync manually if new tools are added elsewhere in the codebase.
// Note: This function contains a hardcoded list of tool tag names that must be kept in sync manually if new tools are added elsewhere in the codebase.
export function processChunk(
  chunk: string, 
  state: { 
    buffer: string; 
    suppressed: boolean; 
    inCodeBlock?: boolean;
    inThink?: boolean;
    codeBuffer?: string;
    printedCodeLinesCount?: number;
    currentIncompleteLine?: string;
    lineBuffer?: string;
    language?: string;
  }
): string {
  if (state.inCodeBlock === undefined) state.inCodeBlock = false;
  if (state.inThink === undefined) state.inThink = false;
  if (state.codeBuffer === undefined) state.codeBuffer = '';
  if (state.printedCodeLinesCount === undefined) state.printedCodeLinesCount = 0;
  if (state.currentIncompleteLine === undefined) state.currentIncompleteLine = '';
  if (state.lineBuffer === undefined) state.lineBuffer = '';
  if (state.language === undefined) state.language = '';

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

  // We append incoming chunk to state.buffer
  state.buffer += chunk;

  while (state.buffer.length > 0) {
    if (state.suppressed) {
      // Once suppressed, return nothing. Clearing/resetting is managed at the end of the streaming loop in index.ts
      return '';
    }

    if (state.inThink) {
      const closeIdx = state.buffer.indexOf('</think>');
      if (closeIdx !== -1) {
        const thinkPart = state.buffer.substring(0, closeIdx);
        processThinkText(thinkPart, true);

        state.inThink = false;
        state.buffer = state.buffer.substring(closeIdx + 8);
        process.stdout.write('\n'); // blank line after thinking
      } else {
        const partialTagMatch = /<\/t?h?i?n?k?>?$/.exec(state.buffer);
        let processLen = state.buffer.length;
        if (partialTagMatch) {
          processLen = partialTagMatch.index;
        }
        if (processLen > 0) {
          const thinkPart = state.buffer.substring(0, processLen);
          processThinkText(thinkPart, false);
          state.buffer = state.buffer.substring(processLen);
        }
        return '';
      }
    } else if (state.inCodeBlock) {
      // Check if we see the end of code block
      const closeIdx = state.buffer.indexOf('```');
      if (closeIdx !== -1) {
        // Process any code text before the closing ```
        const codePart = state.buffer.substring(0, closeIdx);
        processCodeText(codePart, true);

        state.inCodeBlock = false;
        state.buffer = state.buffer.substring(closeIdx + 3);
        
        // Print bottom rule
        const cols = process.stdout.columns || 80;
        const ruleLen = Math.max(cols - 4, 20);
        process.stdout.write('\r\u001b[K  ' + themeBorder('─'.repeat(ruleLen)) + '\n\n');
        
        // Reset code state
        state.codeBuffer = '';
        state.printedCodeLinesCount = 0;
        state.currentIncompleteLine = '';
        state.language = '';
      } else {
        // No closing ``` yet. Process all code text we have, keeping trailing backticks in buffer
        const backtickMatch = /`{1,2}$/.exec(state.buffer);
        let processLen = state.buffer.length;
        if (backtickMatch) {
          processLen = backtickMatch.index;
        }
        if (processLen > 0) {
          const codePart = state.buffer.substring(0, processLen);
          processCodeText(codePart, false);
          state.buffer = state.buffer.substring(processLen);
        }
        return '';
      }
    } else {
      // Look for tool tags, code block start, or think block start
      let earliestIdx = -1;
      let matchType: 'tool' | 'code' | 'think' = 'tool';

      for (const tag of toolTags) {
        const idx = state.buffer.indexOf(tag);
        if (idx !== -1) {
          if (earliestIdx === -1 || idx < earliestIdx) {
            earliestIdx = idx;
            matchType = 'tool';
          }
        }
      }

      const codeIdx = state.buffer.indexOf('```');
      if (codeIdx !== -1) {
        if (earliestIdx === -1 || codeIdx < earliestIdx) {
          earliestIdx = codeIdx;
          matchType = 'code';
        }
      }

      const thinkIdx = state.buffer.indexOf('<think>');
      if (thinkIdx !== -1) {
        if (earliestIdx === -1 || thinkIdx < earliestIdx) {
          earliestIdx = thinkIdx;
          matchType = 'think';
        }
      }

      if (earliestIdx !== -1) {
        if (matchType === 'tool') {
          // Process text before the tool tag
          const before = state.buffer.substring(0, earliestIdx);
          processNormalText(before);

          state.suppressed = true;
          state.buffer = '';
          return '';
        } else if (matchType === 'code') {
          // Process text before code block
          const before = state.buffer.substring(0, earliestIdx);
          processNormalText(before);

          state.inCodeBlock = true;
          const startPart = state.buffer.substring(earliestIdx + 3);
          const newlineIdx = startPart.indexOf('\n');
          let lang = '';
          let consumeLen = 3;
          if (newlineIdx !== -1 && newlineIdx < 20) {
            lang = startPart.substring(0, newlineIdx).trim();
            consumeLen += newlineIdx + 1;
          }
          state.language = lang;

          // Print top rule
          const cols = process.stdout.columns || 80;
          const ruleLen = Math.max(cols - 4, 20);
          const topRule = '  ' + (lang
            ? themePrimary(lang) + ' ' + themeBorder('─'.repeat(Math.max(ruleLen - lang.length - 1, 0)))
            : themeBorder('─'.repeat(ruleLen)));
          
          process.stdout.write('\r\u001b[K' + topRule + '\n');

          state.buffer = startPart.substring(lang ? newlineIdx + 1 : 0);
        } else {
          // Process text before think block
          const before = state.buffer.substring(0, earliestIdx);
          processNormalText(before);

          state.inThink = true;
          process.stdout.write('\n  ' + themeGray.bold('🧠 Thinking:') + '\n');
          state.buffer = state.buffer.substring(earliestIdx + 7);
        }
      } else {
        // No match. Check if we have partial tags at the end of the buffer
        const tagMatch = /<[a-zA-Z_]*$/.exec(state.buffer);
        if (tagMatch) {
          const partial = tagMatch[0];
          const isPrefix = toolTags.some(t => t.startsWith(partial));
          if (isPrefix) {
            const before = state.buffer.substring(0, tagMatch.index);
            processNormalText(before);
            state.buffer = partial;
            return '';
          }
        }

        const codeMatch = /`{1,2}$/.exec(state.buffer);
        if (codeMatch) {
          const before = state.buffer.substring(0, codeMatch.index);
          processNormalText(before);
          state.buffer = codeMatch[0];
          return '';
        }

        const thinkMatch = /<t?h?i?n?k?>?$/.exec(state.buffer);
        if (thinkMatch) {
          const partial = thinkMatch[0];
          if ('<think>'.startsWith(partial)) {
            const before = state.buffer.substring(0, thinkMatch.index);
            processNormalText(before);
            state.buffer = partial;
            return '';
          }
        }

        // Output everything as normal text
        processNormalText(state.buffer);
        state.buffer = '';
      }
    }
  }

  return '';

  // Helper to process think block content
  function processThinkText(text: string, isClosing: boolean) {
    let combined = state.currentIncompleteLine + text;
    const lines = combined.split('\n');
    const completeLinesCount = lines.length - 1;

    for (let i = 0; i < completeLinesCount; i++) {
      const line = lines[i];
      process.stdout.write('\r\u001b[K');
      process.stdout.write(`  ${themeGray('│')} ${themeGray.italic(line)}\n`);
    }

    const lastLine = lines[lines.length - 1];
    state.currentIncompleteLine = lastLine;

    if (isClosing && lastLine !== undefined) {
      process.stdout.write('\r\u001b[K');
      process.stdout.write(`  ${themeGray('│')} ${themeGray.italic(lastLine)}\n`);
      state.currentIncompleteLine = '';
    } else if (!isClosing && lastLine) {
      process.stdout.write('\r\u001b[K');
      process.stdout.write(`  ${themeGray('│')} ${themeGray.italic(lastLine)}`);
    }
  }

  // Helper to process code block content
  function processCodeText(text: string, isClosing: boolean) {
    let combined = state.currentIncompleteLine + text;
    const lines = combined.split('\n');
    const completeLinesCount = lines.length - 1;

    for (let i = 0; i < completeLinesCount; i++) {
      const line = lines[i];
      process.stdout.write('\r\u001b[K');
      state.codeBuffer += (state.codeBuffer ? '\n' : '') + line;

      let highlighted = state.codeBuffer!;
      if (state.language) {
        try {
          highlighted = highlightCli(state.codeBuffer!, { language: state.language });
        } catch (_) {
          highlighted = themeAccentLight(state.codeBuffer!);
        }
      } else {
        highlighted = themeAccentLight(state.codeBuffer!);
      }

      const highlightedLines = highlighted.split('\n');
      const newLineToPrint = highlightedLines[state.printedCodeLinesCount!] || line;
      process.stdout.write('  ' + newLineToPrint + '\n');
      state.printedCodeLinesCount!++;
    }

    const lastLine = lines[lines.length - 1];
    state.currentIncompleteLine = lastLine;

    if (isClosing && lastLine !== undefined) {
      process.stdout.write('\r\u001b[K');
      state.codeBuffer += (state.codeBuffer ? '\n' : '') + lastLine;
      let highlighted = state.codeBuffer!;
      if (state.language) {
        try {
          highlighted = highlightCli(state.codeBuffer!, { language: state.language });
        } catch (_) {
          highlighted = themeAccentLight(state.codeBuffer!);
        }
      } else {
        highlighted = themeAccentLight(state.codeBuffer!);
      }
      const highlightedLines = highlighted.split('\n');
      const newLineToPrint = highlightedLines[state.printedCodeLinesCount!] || lastLine;
      process.stdout.write('  ' + newLineToPrint + '\n');
      state.printedCodeLinesCount!++;
      state.currentIncompleteLine = '';
    } else if (!isClosing && lastLine) {
      process.stdout.write('\r\u001b[K');
      process.stdout.write('  ' + themeAccentLight(lastLine));
    }
  }

  // Helper to process normal markdown text
  function processNormalText(text: string) {
    let combined = state.lineBuffer + text;
    const lines = combined.split('\n');
    const completeLinesCount = lines.length - 1;

    for (let i = 0; i < completeLinesCount; i++) {
      const line = lines[i];
      process.stdout.write('\r\u001b[K');
      const formatted = formatNormalLine(line);
      process.stdout.write(formatted + '\n');
    }

    const lastLine = lines[lines.length - 1];
    state.lineBuffer = lastLine;
    if (lastLine) {
      process.stdout.write('\r\u001b[K');
      process.stdout.write(formatNormalLine(lastLine));
    }
  }

  function formatNormalLine(line: string): string {
    if (line.startsWith('# ')) {
      return themePrimary.bold(line.substring(2));
    }
    if (line.startsWith('## ')) {
      return themePrimary.bold(line.substring(3));
    }
    if (line.startsWith('### ')) {
      return themePrimary.bold(line.substring(4));
    }
    if (line.startsWith('* ')) {
      return `${themeGold('·')} ${line.substring(2)}`;
    }
    if (line.startsWith('- ')) {
      return `${themeGold('·')} ${line.substring(2)}`;
    }

    return line
      .replace(/\*\*([^*]+)\*\*/g, (_, text) => chalk.bold(text))
      .replace(/\*([^*]+)\*/g, (_, text) => chalk.italic(text))
      .replace(/`([^`]+)`/g, (_, text) => themeAccentLight.bgHex(themeBg)(' ' + text + ' '));
  }
}

export function hasRepetitionLoop(text: string): boolean {
  const len = text.length;
  // Look for repeating suffixes of length 10 to 200 characters
  const maxChunkSize = Math.min(200, Math.floor(len / 3));
  for (let size = 10; size <= maxChunkSize; size++) {
    const chunk3 = text.slice(-size);
    const chunk2 = text.slice(-2 * size, -size);
    const chunk1 = text.slice(-3 * size, -2 * size);
    if (chunk1 === chunk2 && chunk2 === chunk3) {
      // Must contain at least one letter and have a character variety of at least 3 unique characters
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
