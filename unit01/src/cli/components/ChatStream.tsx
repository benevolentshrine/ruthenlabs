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
  showThinking: boolean;
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

interface ParsedMessage {
  prose: string;
  thinkContent: string;
}

function parseMessageContent(text: string): ParsedMessage {
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
  let remainingText = '';
  let thinkContent = '';
  let lastIdx = 0;

  while ((match = thinkPattern.exec(processable)) !== null) {
    if (match.index > lastIdx) {
      remainingText += processable.substring(lastIdx, match.index);
    }
    thinkContent += (thinkContent ? '\n' : '') + match[1].trim();
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < processable.length) {
    remainingText += processable.substring(lastIdx);
  }

  return {
    prose: remainingText,
    thinkContent
  };
}

export function ChatStream({ text, isStreaming, thinkingEnabled, showThinking }: ChatStreamProps): React.ReactElement | null {
  const { prose, thinkContent } = useMemo(() => {
    return parseMessageContent(text);
  }, [text]);

  const renderedProse = useMemo(() => {
    if (!prose.trim()) return '';
    try {
      return marked.parse(prose) as string;
    } catch {
      return prose;
    }
  }, [prose]);

  if (!(renderedProse as string).trim() && !thinkContent.trim() && !isStreaming) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1}>
      {isStreaming && (
        <Box marginBottom={1}>
          <Text color="#4ADE80">● Streaming response...</Text>
        </Box>
      )}

      {/* Model Thought block */}
      {thinkingEnabled && thinkContent.trim().length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Text color="#475569" bold>Thinking: </Text>
            {showThinking ? (
              <Text color="#64748B" italic>(Press Ctrl+O to collapse)</Text>
            ) : (
              <Text color="#64748B" italic>[Collapsed · Press Ctrl+O to expand]</Text>
            )}
          </Box>
          {showThinking && (
            <Box
              marginTop={1}
              borderStyle="single"
              borderLeft={true}
              borderRight={false}
              borderTop={false}
              borderBottom={false}
              borderColor="#475569"
              paddingLeft={1}
            >
              <Text color="#64748B" italic>
                {thinkContent}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {(renderedProse as string).trim().length > 0 && <Text>{renderedProse as string}</Text>}
    </Box>
  );
}
