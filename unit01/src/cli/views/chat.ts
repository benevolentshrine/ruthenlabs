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
export function processChunk(chunk: string, state: { buffer: string; suppressed: boolean; inCodeBlock?: boolean }): string {
  if (state.suppressed) {
    return '';
  }
  
  if (state.inCodeBlock === undefined) {
    state.inCodeBlock = false;
  }

  let full = state.buffer + chunk;
  let result = '';

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

  while (full.length > 0) {
    if (state.inCodeBlock) {
      // In a code block, suppress all output until we see a closing ```
      const closeIdx = full.indexOf('```');
      if (closeIdx !== -1) {
        state.inCodeBlock = false;
        full = full.substring(closeIdx + 3);
      } else {
        // Keep partial trailing backticks in the buffer
        const match = /`{1,2}$/.exec(full);
        if (match) {
          state.buffer = match[0];
        } else {
          state.buffer = '';
        }
        return result;
      }
    } else {
      let earliestIdx = -1;
      let matchType: 'tool' | 'code' = 'tool';

      for (const tag of toolTags) {
        const idx = full.indexOf(tag);
        if (idx !== -1) {
          if (earliestIdx === -1 || idx < earliestIdx) {
            earliestIdx = idx;
            matchType = 'tool';
          }
        }
      }

      const codeIdx = full.indexOf('```');
      if (codeIdx !== -1) {
        if (earliestIdx === -1 || codeIdx < earliestIdx) {
          earliestIdx = codeIdx;
          matchType = 'code';
        }
      }

      if (earliestIdx !== -1) {
        if (matchType === 'tool') {
          state.suppressed = true;
          state.buffer = '';
          result += full.substring(0, earliestIdx);
          return result;
        } else {
          result += full.substring(0, earliestIdx);
          state.inCodeBlock = true;
          full = full.substring(earliestIdx + 3);
        }
      } else {
        const tagMatch = /<[a-zA-Z_]*$/.exec(full);
        if (tagMatch) {
          const partial = tagMatch[0];
          const isPrefix = toolTags.some(t => t.startsWith(partial));
          if (isPrefix) {
            state.buffer = partial;
            result += full.substring(0, tagMatch.index);
            return result;
          }
        }

        const codeMatch = /`{1,2}$/.exec(full);
        if (codeMatch) {
          state.buffer = codeMatch[0];
          result += full.substring(0, codeMatch.index);
          return result;
        }

        result += full;
        state.buffer = '';
        return result;
      }
    }
  }

  state.buffer = '';
  return result;
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
