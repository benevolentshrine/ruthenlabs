import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { themeGold } from '../views/theme.js';

const SANSKRIT = 'अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह';
const GOLD_GRADIENT = ['#F59E0B', '#D97706', '#B45309', '#92400E', '#B45309', '#D97706', '#F59E0B', '#FCD34D'];
const CASCADE_TICKS = 15;
const MAX_VISIBLE = 8;

interface ThinkingSpinnerProps {
  active: boolean;
}

export function ThinkingSpinner({ active }: ThinkingSpinnerProps) {
  const [tick, setTick] = useState(0);
  const [chars, setChars] = useState<string[]>([]);

  useEffect(() => {
    if (!active) {
      setTick(0);
      setChars([]);
      return;
    }

    const interval = setInterval(() => {
      setTick((t) => t + 1);

      if (tick < CASCADE_TICKS) {
        // Phase 1: cascade — add Sanskrit chars
        setChars((prev) => {
          const next = [...prev, SANSKRIT[Math.floor(Math.random() * SANSKRIT.length)]];
          return next.length > MAX_VISIBLE ? next.slice(next.length - MAX_VISIBLE) : next;
        });
      }
    }, 80);

    return () => clearInterval(interval);
  }, [active, tick]);

  if (!active) return null;

  // Phase 2: ambient pulse
  if (tick >= CASCADE_TICKS) {
    const brightness = 10 + Math.abs(Math.sin(tick * 0.15)) * 90;
    const opacity = brightness / 100;
    const pulseChar = SANSKRIT[tick % SANSKRIT.length];
    // Warm orange pulse via hex interpolation
    const r = Math.round(249 * opacity);
    const g = Math.round(115 * opacity);
    const b = Math.round(22 * opacity);
    const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

    return (
      <Box>
        <Text color={hex}>{pulseChar}</Text>
      </Box>
    );
  }

  // Phase 1: cascade with gold gradient
  return (
    <Box>
      {chars.map((char, i) => (
        <Text key={i} color={GOLD_GRADIENT[i % GOLD_GRADIENT.length]}>{char}</Text>
      ))}
    </Box>
  );
}
