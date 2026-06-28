#!/usr/bin/env -S node --no-warnings
/**
 * app.tsx — Root Ink component for Unit01 CLI
 * 
 * Replaces the rendering logic from the old index.ts (1878 lines).
 * All business logic (LLM, tools, sessions) is delegated to hooks and callbacks.
 * This file only handles WHAT to render based on the current app state.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import chalk from 'chalk';
import {
  themePrimary,
  themeBorder,
  themeAccent,
  themeGold,
  themeGray,
  themeRed,
  isGui,
  guiEmit
} from './views/theme.js';
import {
  WelcomeBanner,
  ThinkingSpinner,
  ToolProgress,
  ChatStream,
  SystemMessage,
  ToolResult,
  SelectMenu,
  ConfirmWrite,
  PromptInput,
  DiffView,
  InteractiveInput
} from './components/index.js';
import type { CoreServices, AppScreen, OutputEntry } from './types.js';

interface AppProps {
  services: CoreServices;
}

export function App({ services }: AppProps) {
  const { exit } = useApp();

  // App state machine
  const [screen, setScreen] = useState<AppScreen>('prompt');
  const [output, setOutput] = useState<OutputEntry[]>([]);

  // Streaming state
  const [streamText, setStreamText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [spinnerActive, setSpinnerActive] = useState(false);
  const [toolProgressActive, setToolProgressActive] = useState(false);
  const [toolProgressDetails, setToolProgressDetails] = useState('');

  // Modal state
  const [selectMenuProps, setSelectMenuProps] = useState<{
    title: string;
    options: string[];
    resolve: (index: number) => void;
  } | null>(null);

  const [confirmWriteProps, setConfirmWriteProps] = useState<{
    filePath: string;
    lineCount: number;
    actionVerb: 'write' | 'create' | 'modify';
    resolve: (choice: 'y' | 'n' | 'p') => void;
  } | null>(null);

  const [diffViewProps, setDiffViewProps] = useState<{
    original: string | null;
    modified: string;
    language: string;
    filePath: string;
  } | null>(null);

  const [interactiveInputProps, setInteractiveInputProps] = useState<{
    title: string;
    placeholder?: string;
    resolve: (val: string) => void;
  } | null>(null);

  // Status bar state
  const [statusModel, setStatusModel] = useState('');
  const [statusContext, setStatusContext] = useState('');
  const [statusBranch, setStatusBranch] = useState('');

  // Welcome info
  const [welcomeShown, setWelcomeShown] = useState(false);
  const [welcomeHints, setWelcomeHints] = useState<string[]>([]);

  // Ref to prevent double-init
  const initialized = useRef(false);
  const autoSubmitted = useRef(false);

  // Listen for Escape during model streaming to abort the generation
  useInput((input, key) => {
    if (screen === 'streaming' && key.escape) {
      services.abortStreaming();
    }
  });

  // Initialize on mount
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    setStatusModel(services.activeModel);
    setStatusBranch(services.gitBranch);
    setWelcomeShown(true);

    // Build welcome hints
    const hints: string[] = [];
    if (services.isFirstRun) {
      hints.push(`◈ Type ${chalk.cyan('/')} to see commands  ·  type anything to begin`);
      hints.push(`◈ Press ${chalk.cyan('Escape')} to stop generation`);
    }
    if (services.latestSession && !services.isFirstRun) {
      hints.push(`⤿ Last session ${services.latestSession.relTime} · "${services.latestSession.label}"`);
      hints.push(`  Type ${chalk.cyan('/sessions')} to browse all, or just start typing.`);
    }
    setWelcomeHints(hints);
  }, []);

  // Update status bar
  const updateStatus = useCallback((model: string, ctx: string, branch: string) => {
    setStatusModel(model);
    setStatusContext(ctx);
    setStatusBranch(branch);
  }, []);

  // Add output entry
  const addOutput = useCallback((entry: OutputEntry) => {
    setOutput(prev => [...prev, entry]);
  }, []);

  // ── UI Adapters ──
  // These functions are passed to the business logic so it can trigger UI changes
  // without knowing about React/Ink

  const uiAdapter = {
    // System messages
    printSystemMessage: (type: 'error' | 'warn' | 'guard' | 'info' | 'stop', message: string) => {
      addOutput({ type: 'system', data: { type, message } });
    },

    // Tool results
    printToolResult: (status: 'success' | 'failure' | 'skipped', message: string) => {
      addOutput({ type: 'tool-result', data: { status, message } });
    },

    // Interactive select (returns a promise)
    interactiveSelect: (title: string, options: string[]): Promise<number> => {
      return new Promise((resolve) => {
        setScreen('select');
        setSelectMenuProps({ title, options, resolve });
      });
    },

    interactiveInput: (title: string, placeholder?: string): Promise<string> => {
      return new Promise((resolve) => {
        setScreen('input');
        setInteractiveInputProps({ title, placeholder, resolve });
      });
    },

    // Confirm write (returns a promise)
    interactiveConfirmWrite: (
      filePath: string,
      lineCount: number,
      actionVerb: 'write' | 'create' | 'modify'
    ): Promise<'y' | 'n' | 'p'> => {
      return new Promise((resolve) => {
        setScreen('confirm');
        setConfirmWriteProps({ filePath, lineCount, actionVerb, resolve });
      });
    },

    // Show diff
    showDiff: (original: string | null, modified: string, language: string, filePath: string) => {
      setDiffViewProps({ original, modified, language, filePath });
    },

    // Streaming control
    startStreaming: () => {
      setStreamText('');
      setIsStreaming(true);
      setSpinnerActive(true);
      setScreen('streaming');
    },

    onStreamChunk: (chunk: string) => {
      setSpinnerActive(false);
      setStreamText(prev => prev + chunk);
    },

    endStreaming: () => {
      setIsStreaming(false);
      setSpinnerActive(false);
    },

    // Tool progress
    showToolProgress: (details: string) => {
      setToolProgressActive(true);
      setToolProgressDetails(details);
    },

    hideToolProgress: () => {
      setToolProgressActive(false);
      setToolProgressDetails('');
    },

    // Return to prompt
    returnToPrompt: () => {
      setScreen('prompt');
      setDiffViewProps(null);
    },

    // Update status bar
    updateStatus,

    // Exit
    exit: (code: number) => {
      exit();
      process.exit(code);
    },

    // Add raw text output
    addTextOutput: (text: string) => {
      addOutput({ type: 'text', data: text });
    },

    // Print final completed model response
    printModelResponse: (text: string, thinkingEnabled: boolean) => {
      addOutput({ type: 'model-response', data: { text, thinkingEnabled } });
    }
  };

  // Handle user input submission
  const handleSubmit = useCallback(async (input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Echo user input
    addOutput({ type: 'user-input', data: input });

    // Delegate to business logic
    await services.handleInput(trimmed, uiAdapter);
  }, [services, uiAdapter]);

  useEffect(() => {
    if (services.nonInteractivePrompt && !autoSubmitted.current) {
      autoSubmitted.current = true;
      handleSubmit(services.nonInteractivePrompt);
    }
  }, [services.nonInteractivePrompt, handleSubmit]);

  // Handle select menu choice
  const handleSelect = useCallback((index: number) => {
    if (selectMenuProps) {
      selectMenuProps.resolve(index);
      setSelectMenuProps(null);
      setScreen('prompt');
    }
  }, [selectMenuProps]);

  // Handle confirm write choice
  const handleConfirmChoice = useCallback((choice: 'y' | 'n' | 'p') => {
    if (confirmWriteProps) {
      confirmWriteProps.resolve(choice);
      setConfirmWriteProps(null);
      setScreen('prompt');
    }
  }, [confirmWriteProps]);

  // Handle interactive text input submit
  const handleInputValueSubmit = useCallback((val: string) => {
    if (interactiveInputProps) {
      interactiveInputProps.resolve(val);
      setInteractiveInputProps(null);
      setScreen('prompt');
    }
  }, [interactiveInputProps]);

  // ── Render ──
  return (
    <Box flexDirection="column">
      {/* Welcome Banner */}
      {welcomeShown && (
        <WelcomeBanner
          workspaceRoot={services.workspaceRoot}
          modelName={statusModel}
          contextLimit={services.contextLimit}
          fileCount={services.filesCount}
          gitBranch={services.gitBranch}
          projectType={services.projectType}
          latestSession={services.latestSession}
        />
      )}

      {/* Output History */}
      {output.map((entry, i) => {
        if (entry.type === 'system') {
          return (
            <Box key={i} marginTop={1}>
              <SystemMessage type={entry.data.type} message={entry.data.message} />
            </Box>
          );
        }
        if (entry.type === 'tool-result') {
          const prevEntry = i > 0 ? output[i - 1] : null;
          const isFirstInSequence = !prevEntry || prevEntry.type !== 'tool-result';
          return (
            <Box key={i} marginTop={isFirstInSequence ? 1 : 0}>
              <ToolResult status={entry.data.status} message={entry.data.message} />
            </Box>
          );
        }
        if (entry.type === 'user-input') {
          return (
            <Box key={i} marginTop={1}>
              <Text>
                {themePrimary('❯')} {chalk.hex('#4682B4')(entry.data)}
              </Text>
            </Box>
          );
        }
        if (entry.type === 'model-response') {
          return (
            <Box key={i}>
              <ChatStream
                text={entry.data.text}
                isStreaming={false}
                thinkingEnabled={entry.data.thinkingEnabled}
              />
            </Box>
          );
        }
        if (entry.type === 'text') {
          return (
            <Box key={i} marginTop={1}>
              <Text>{entry.data}</Text>
            </Box>
          );
        }
        return null;
      })}

      {/* Diff View (shown inline when previewing) */}
      {diffViewProps && (
        <DiffView
          original={diffViewProps.original}
          modified={diffViewProps.modified}
          language={diffViewProps.language}
          filePath={diffViewProps.filePath}
        />
      )}

      {/* Streaming AI Response */}
      {screen === 'streaming' && (
        <Box flexDirection="column">
          <ThinkingSpinner active={spinnerActive} />
          {!spinnerActive && (
            <ChatStream
              text={streamText}
              isStreaming={isStreaming}
              thinkingEnabled={services.thinkingEnabled}
            />
          )}
          <ToolProgress active={toolProgressActive} details={toolProgressDetails} />
        </Box>
      )}

      {/* Select Menu Modal */}
      {screen === 'select' && selectMenuProps && (
        <SelectMenu
          title={selectMenuProps.title}
          options={selectMenuProps.options}
          onSelect={handleSelect}
        />
      )}

      {/* Confirm Write Modal */}
      {screen === 'confirm' && confirmWriteProps && (
        <ConfirmWrite
          filePath={confirmWriteProps.filePath}
          lineCount={confirmWriteProps.lineCount}
          actionVerb={confirmWriteProps.actionVerb}
          onChoice={handleConfirmChoice}
        />
      )}

      {/* Interactive Text Input Modal */}
      {screen === 'input' && interactiveInputProps && (
        <InteractiveInput
          title={interactiveInputProps.title}
          placeholder={interactiveInputProps.placeholder}
          onSubmit={handleInputValueSubmit}
        />
      )}

      {/* Input Prompt */}
      {screen === 'prompt' && (
        <Box marginTop={1}>
          <PromptInput
            onSubmit={handleSubmit}
            status={{
              model: statusModel,
              contextPct: statusContext,
              branch: statusBranch
            }}
          />
        </Box>
      )}
    </Box>
  );
}
