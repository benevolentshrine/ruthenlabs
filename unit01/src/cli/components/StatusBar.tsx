import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  model: string;
  contextPct: string;
  branch: string;
}

export function StatusBar({ model, contextPct, branch }: StatusBarProps) {
  if (!model) return null;
  const cwd = process.cwd();
  const branchText = branch ? `  ·  ${branch}` : '';
  const contextText = contextPct ? `  ·  ${contextPct}` : '';

  return (
    <Box width="100%" justifyContent="space-between">
      <Text color="#64748B">◈ {model}{branchText}{contextText}</Text>
      <Text color="#64748B">{cwd}</Text>
    </Box>
  );
}
