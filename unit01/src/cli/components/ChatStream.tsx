import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { highlight as highlightCli } from 'cli-highlight';

interface ChatStreamProps {
  text: string;
  isStreaming: boolean;
  thinkingEnabled: boolean;
}

// Configure marked with TerminalRenderer
marked.setOptions({
  renderer: new TerminalRenderer({
    codespan: chalk.hex('#FAB387').bgHex('#1E293B'),
    firstHeading: chalk.hex('#E2E8F0').bold,
    heading: chalk.hex('#E2E8F0').bold,
    code: (code: string, lang: string | undefined) => {
      const rule = '─'.repeat(40);
      let highlighted = code;
      try {
        highlighted = highlightCli(code, { language: lang || 'text' });
      } catch {
        highlighted = chalk.hex('#FAB387')(code);
      }
      const lines = highlighted.split('\n');
      if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }
      return `\n  ${chalk.hex('#E2E8F0')(lang || 'text')} ${chalk.hex('#475569')(rule)}\n${lines.map((l: string) => `  ${l}`).join('\n')}\n  ${chalk.hex('#475569')(rule)}\n`;
    }
  })
});

function renderMarkdownWithThink(text: string, thinkingEnabled: boolean): string {
  // Strip after tool tag
  let processable = text;
  const TOOL_TAGS = [
    '<run_command', '<read_file', '<search_code', '<write_file',
    '<patch_file', '<patch_file_blocks', '<list_dir', '<git_status',
    '<diagnostics', '<move_file', '<question', '<path_question'
  ];
  for (const tag of TOOL_TAGS) {
    const idx = processable.indexOf(tag);
    if (idx !== -1) {
      processable = processable.substring(0, idx);
      break;
    }
  }

  // Parse think blocks
  const thinkPattern = /<think>([\s\S]*?)(?:<\/think>|$)/g;
  let match;
  let outputText = '';
  let lastIdx = 0;

  while ((match = thinkPattern.exec(processable)) !== null) {
    // Render text before think block
    if (match.index > lastIdx) {
      const before = processable.substring(lastIdx, match.index);
      try {
        outputText += marked.parse(before);
      } catch {
        outputText += before;
      }
    }

    if (thinkingEnabled) {
      const thinkContent = match[1].trim();
      if (thinkContent) {
        outputText += `\n  ${chalk.hex('#64748B').bold('🧠 Thinking:')}\n`;
        const lines = thinkContent.split('\n');
        outputText += lines.map(line => `  ${chalk.hex('#64748B').italic(`│ ${line}`)}`).join('\n') + '\n';
      }
    }

    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < processable.length) {
    const remaining = processable.substring(lastIdx);
    try {
      outputText += marked.parse(remaining);
    } catch {
      outputText += remaining;
    }
  }

  return outputText;
}

export function ChatStream({ text, isStreaming, thinkingEnabled }: ChatStreamProps): React.ReactElement {
  const rendered = useMemo(() => {
    return renderMarkdownWithThink(text, thinkingEnabled);
  }, [text, thinkingEnabled]);

  return (
    <Box flexDirection="row" marginTop={1} marginBottom={1}>
      {isStreaming && <Text color="#F97316">● </Text>}
      <Text>{rendered}</Text>
    </Box>
  );
}
