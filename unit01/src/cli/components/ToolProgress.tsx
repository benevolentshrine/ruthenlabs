import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface ToolProgressProps {
  active: boolean;
  details: string;
}

export function ToolProgress({ active, details }: ToolProgressProps) {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setFrameIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setFrameIndex((i) => (i + 1) % BRAILLE_FRAMES.length);
    }, 80);

    return () => clearInterval(interval);
  }, [active]);

  if (!active) return null;

  const frame = BRAILLE_FRAMES[frameIndex];

  return (
    <Box>
      <Text color="#38BDF8">  {frame} </Text>
      <Text color="#F1F5F9">{details}</Text>
    </Box>
  );
}
