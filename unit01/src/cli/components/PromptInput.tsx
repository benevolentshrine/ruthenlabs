import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useStdout, useStdin } from 'ink';
import { themePrimary, themeBorder, themeGold, themeGray } from '../views/theme.js';
import { StatusBar } from './StatusBar.js';
import { CommandPopup } from './CommandPopup.js';

interface PromptInputProps {
  onSubmit: (input: string) => void;
  status: { model: string; contextPct: string; branch: string };
}

// Module-level persistence across renders
const inputHistory: string[] = [];
const MAX_HISTORY = 50;

const commands = [
  '/models', '/thinking', '/status', '/usage', '/sessions',
  '/compact', '/clear', '/help', '/exit', '/quit',
  '/files', '/reindex', '/export', '/preview', '/changes',
  '/undo', '/search', '/connect', '/audit', '/autopilot', '/reset-password',
];

export function PromptInput({ onSubmit, status }: PromptInputProps) {
  const [value, setValue] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [showPopup, setShowPopup] = useState(true);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isGold, setIsGold] = useState(true);

  const cursorPosRef = React.useRef(cursorPos);
  useEffect(() => {
    cursorPosRef.current = cursorPos;
  }, [cursorPos]);

  const isPastingRef = React.useRef(false);

  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const cols = stdout?.columns || 80;

  // Custom bracketed paste handling
  useEffect(() => {
    if (!stdout) return;
    stdout.write('\x1b[?2004h');
    return () => {
      stdout.write('\x1b[?2004l');
    };
  }, [stdout]);

  useEffect(() => {
    let isPasting = false;
    let pasteBuffer = '';

    const onData = (data: Buffer) => {
      const str = data.toString('utf-8');
      
      if (str.includes('\x1b[200~')) {
        isPasting = true;
        isPastingRef.current = true;
        const parts = str.split('\x1b[200~');
        pasteBuffer = parts[1] || '';
        if (pasteBuffer.includes('\x1b[201~')) {
          isPasting = false;
          const pasteContent = pasteBuffer.split('\x1b[201~')[0];
          setValue((prev: string) => {
            const pos = (cursorPosRef.current < 0 || cursorPosRef.current > prev.length) ? prev.length : cursorPosRef.current;
            const before = prev.slice(0, pos);
            const after = prev.slice(pos);
            setCursorPos(before.length + pasteContent.length);
            return before + pasteContent + after;
          });
          setShowPopup(false);
          pasteBuffer = '';
          setTimeout(() => {
            isPastingRef.current = false;
          }, 50);
        }
        return;
      }
      if (isPasting) {
        if (str.includes('\x1b[201~')) {
          isPasting = false;
          pasteBuffer += str.split('\x1b[201~')[0];
          const pasteContent = pasteBuffer;
          setValue((prev: string) => {
            const pos = (cursorPosRef.current < 0 || cursorPosRef.current > prev.length) ? prev.length : cursorPosRef.current;
            const before = prev.slice(0, pos);
            const after = prev.slice(pos);
            setCursorPos(before.length + pasteContent.length);
            return before + pasteContent + after;
          });
          setShowPopup(false);
          pasteBuffer = '';
          setTimeout(() => {
            isPastingRef.current = false;
          }, 50);
        } else {
          pasteBuffer += str;
        }
        return;
      }
    };

    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin]);

  // Cursor pulse effect
  useEffect(() => {
    const timer = setInterval(() => setIsGold((g: boolean) => !g), 600);
    return () => clearInterval(timer);
  }, []);

  // Command autocomplete matches
  const getMatches = useCallback((): string[] => {
    if (!showPopup || !value.startsWith('/')) return [];
    const query = value.toLowerCase();
    const all = commands.filter(c => c.startsWith(query));
    const filtered: string[] = [];
    let len = 6;
    for (const cmd of all) {
      const cmdLen = cmd.length + 4;
      if (len + cmdLen < cols - 5) {
        filtered.push(cmd);
        len += cmdLen;
      } else break;
    }
    return filtered;
  }, [value, showPopup, cols]);

  useInput(useCallback((input: string, key: any) => {
    // Intercept bracketed paste markers in useInput in case they arrive here
    if (input && input.includes('\x1b[200~')) {
      isPastingRef.current = true;
      return;
    }
    if (input && input.includes('\x1b[201~')) {
      setTimeout(() => {
        isPastingRef.current = false;
      }, 50);
      return;
    }

    // Ignore typed key events during an active paste to prevent duplicates and event locks
    if (isPastingRef.current) {
      return;
    }

    // Submit
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== trimmed)) {
        inputHistory.push(trimmed);
        if (inputHistory.length > MAX_HISTORY) inputHistory.shift();
      }
      onSubmit(value);
      setValue('');
      setCursorPos(0);
      setHistoryIndex(-1);
      setShowPopup(true);
      return;
    }

    // Escape: hide popup
    if (key.escape) { setShowPopup(false); return; }

    // Tab: autocomplete first match
    if (key.tab) {
      const matches = getMatches();
      if (matches.length > 0) {
        setValue(matches[0]);
        setCursorPos(matches[0].length);
      }
      return;
    }

    // History: Up
    if (key.upArrow) {
      // Only navigate history when cursor is on the first line
      const firstNewline = value.indexOf('\n');
      const onFirstLine = firstNewline === -1 || cursorPos <= firstNewline;
      if (onFirstLine && inputHistory.length > 0 && historyIndex < inputHistory.length - 1) {
        const newIdx = historyIndex + 1;
        const entry = inputHistory[inputHistory.length - 1 - newIdx];
        setHistoryIndex(newIdx);
        setValue(entry);
        setCursorPos(entry.length);
        setShowPopup(false);
      }
      return;
    }

    // History: Down
    if (key.downArrow) {
      if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        const entry = inputHistory[inputHistory.length - 1 - newIdx];
        setHistoryIndex(newIdx);
        setValue(entry);
        setCursorPos(entry.length);
        setShowPopup(false);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setValue('');
        setCursorPos(0);
        setShowPopup(true);
      }
      return;
    }

    // Backspace & ASCII 127/8 & Delete
    const isBackspace = key.backspace || key.delete || (input && (input.charCodeAt(0) === 127 || input.charCodeAt(0) === 8));
    if (isBackspace) {
      if (value.length > 0) {
        setValue((v: string) => {
          const pos = (cursorPos <= 0 || cursorPos > v.length) ? v.length : cursorPos;
          const before = v.slice(0, pos - 1);
          const after = v.slice(pos);
          setCursorPos(before.length);
          return before + after;
        });
      }
      return;
    }

    // Left/Right
    if (key.leftArrow) { setCursorPos((p: number) => Math.max(0, p - 1)); return; }
    if (key.rightArrow) { setCursorPos((p: number) => Math.min(value.length, p + 1)); return; }

    // Regular character input (excluding control codes, backspace, and modifiers)
    if (input && input.length === 1 && input.charCodeAt(0) >= 32 && input.charCodeAt(0) !== 127 && input.charCodeAt(0) !== 8 && !key.ctrl && !key.meta) {
      setValue((v: string) => {
        const pos = (cursorPos < 0 || cursorPos > v.length) ? v.length : cursorPos;
        const before = v.slice(0, pos);
        const after = v.slice(pos);
        setCursorPos(before.length + 1);
        return before + input + after;
      });
      setShowPopup(true);
    }
  }, [value, cursorPos, historyIndex, onSubmit, getMatches]));

  const matches = getMatches();
  const promptChar = isGold ? themeGold('❯') : themePrimary('❯');
  const border = themeBorder('─'.repeat(cols));

  // Build display lines for multi-line input
  const displayLines = value.split('\n');

  const renderInputLines = () => {
    // If the input has multiple lines (e.g. from pasting), show only a clean, simple collapse placeholder
    if (displayLines.length > 1) {
      return (
        <Text color="#F59E0B">
          {`${promptChar} [Pasted: ${displayLines.length} lines of text]`}
        </Text>
      );
    }

    const before = value.slice(0, cursorPos);
    const cursorChar = value[cursorPos] || ' ';
    const after = value.slice(cursorPos + 1);
    const cursorElement = themeGold.inverse(cursorChar);

    return (
      <Text>
        {`${promptChar} `}
        {themePrimary(before)}
        {cursorElement}
        {themePrimary(after)}
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      {matches.length > 0 && (
        <CommandPopup matches={matches} currentInput={value} />
      )}
      <Text>{border}</Text>
      <Box flexDirection="column">
        {renderInputLines()}
      </Box>
      <Text>{border}</Text>
      <StatusBar
        model={status.model}
        contextPct={status.contextPct}
        branch={status.branch}
      />
    </Box>
  );
}
