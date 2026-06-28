import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  model: string;
}

export function StatusBar({ model }: StatusBarProps) {
  if (!model) return null;
  const cwd = process.cwd();

  return (
    <Box>
      <Text color="#475569">  {model}  ·  {cwd}</Text>
    </Box>
  );
}
