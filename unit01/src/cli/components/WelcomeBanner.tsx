import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { isGui, guiEmit, themeGray } from '../views/theme.js';

interface WelcomeBannerProps {
  workspaceRoot: string;
  modelName: string;
  contextLimit: number;
  fileCount: number;
  gitBranch: string;
  projectType: string | null;
  latestSession: { relTime: string; label: string } | null;
}

export function WelcomeBanner({
  workspaceRoot,
  modelName,
  contextLimit,
  fileCount,
  gitBranch,
  projectType,
  latestSession
}: WelcomeBannerProps) {
  if (isGui) {
    guiEmit({ type: 'init', workspaceRoot, modelName, contextLimit, fileCount });
    return null;
  }

  // Simple circle glyph in neon green
  const circleIcon = chalk.hex('#10B981')('●');
  const separator = chalk.hex('#64748B')('  ·  ');

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>
        {circleIcon}{'  '}
        <Text bold color="#E2E8F0">Unit01 v1.0.0</Text>
        {separator}
        <Text color="#94A3B8">{modelName}</Text>
        {separator}
        <Text color="#94A3B8">{gitBranch}</Text>
      </Text>
      <Text>
        {'   '}
        {projectType && (
          <Text color="#64748B">
            📦 {projectType} project detected
          </Text>
        )}
        {latestSession && (
          <Text color="#64748B">
            {projectType ? separator : ''}
            ⤿ Last session {latestSession.relTime} · "{latestSession.label}"
          </Text>
        )}
      </Text>
    </Box>
  );
}
