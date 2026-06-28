import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { themePrimary, themeGold } from '../views/theme.js';

interface InteractiveInputProps {
  title: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}

export function InteractiveInput({ title, placeholder = '', onSubmit }: InteractiveInputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.escape) {
      onSubmit('');
      return;
    }
    if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
      return;
    }
    if (input && input.length === 1 && input.charCodeAt(0) >= 32) {
      setValue(prev => prev + input);
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="#38BDF8">{title}</Text>
      <Box>
        <Text>{`❯ `}</Text>
        {value ? (
          <Text>{value}</Text>
        ) : (
          <Text color="gray">{placeholder}</Text>
        )}
        <Text>{themeGold.inverse(' ')}</Text>
      </Box>
    </Box>
  );
}
