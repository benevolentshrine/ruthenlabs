import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { themeGray } from '../views/theme.js';

interface StatusBarProps {
  model: string;
  contextPct: string;
  branch: string;
}

export function StatusBar({ model, contextPct, branch }: StatusBarProps) {
  if (!model) return null;

  return (
    <Box>
      <Text color="#64748B">  {model}  ·  {contextPct}  ·  {branch}</Text>
    </Box>
  );
}
