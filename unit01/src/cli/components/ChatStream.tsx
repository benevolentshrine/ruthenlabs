import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { highlight as highlightCli } from 'cli-highlight';
import { syntaxHighlightTheme } from '../views/theme.js';

interface ChatStreamProps {
  text: string;
  isStreaming: boolean;
  thinkingEnabled: boolean;
}

// Configure marked with TerminalRenderer
marked.setOptions({
  renderer: new TerminalRenderer({
    codespan: chalk.hex('#38BDF8').bgHex('#1E293B'),
    firstHeading: chalk.hex('#F1F5F9').bold,
    heading: chalk.hex('#F1F5F9').bold,
    code: (code: string, lang: string | undefined) => {
      const rule = '─'.repeat(40);
      let highlighted = code;
      try {
        highlighted = highlightCli(code, { language: lang || 'text', theme: syntaxHighlightTheme });
      } catch {
        highlighted = chalk.hex('#38BDF8')(code);
      }
      const lines = highlighted.split('\n');
      if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
        lines.pop();
      }
      return `\n  ${chalk.hex('#F1F5F9')(lang || 'text')} ${chalk.hex('#334155')(rule)}\n${lines.map((l: string) => `  ${l}`).join('\n')}\n  ${chalk.hex('#334155')(rule)}\n`;
    }
  })
});

function renderMarkdownWithThink(text: string, thinkingEnabled: boolean): string {
  // Strip after tool tag
  let processable = text;
  const TOOL_TAGS = [
    '<run_command', '<read_file', '<search_code', '<write_file',
    '<patch_file', '<patch_file_blocks', '<list_dir', '<git_status',
    '<diagnostics', '<move_file', '<question', '<path_question',
    '<sandbox_exec', '<edit_file', '<search', '<view_outline', '<ask_user'
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
        outputText += `\n  ${chalk.hex('#475569').bold('🧠 Thinking:')}\n`;
        const lines = thinkContent.split('\n');
        outputText += lines.map(line => `  ${chalk.hex('#475569').italic(`│ ${line}`)}`).join('\n') + '\n';
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

export function ChatStream({ text, isStreaming, thinkingEnabled }: ChatStreamProps): React.ReactElement | null {
  const rendered = useMemo(() => {
    return renderMarkdownWithThink(text, thinkingEnabled);
  }, [text, thinkingEnabled]);

  if (!rendered.trim() && !isStreaming) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      <Box
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderColor="#334155"
        paddingLeft={1}
      >
        <Box flexDirection="column">
          {isStreaming && (
            <Box marginBottom={1}>
              <Text color="#4ADE80">● Streaming response...</Text>
            </Box>
          )}
          <Text>{rendered}</Text>
        </Box>
      </Box>
    </Box>
  );
}
