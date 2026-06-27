#!/usr/bin/env -S node --no-warnings
import '../core/warnings.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { render } from 'ink';
import React from 'react';

import { DirectiveIndexer } from '../core/indexer/index.js';
import { DirectiveSandbox } from '../core/security/sandbox.js';
import { ollama } from '../core/llm/client.js';
import { buildRepoMap } from '../core/indexer/repomap.js';
import { AllowedPath } from '../core/security/types.js';
import { SessionStore, SessionData, runStalenessCheck } from '../core/session/index.js';
import { handleToolCalls } from './commands.js';
import {
  themePrimary,
  themeOrange,
  themeAccent,
  themeGray,
  themeRed,
  isGui,
  guiEmit
} from './views/theme.js';
import { getLanguageFromFilename } from './parser.js';
import { App } from './app.js';
import { CoreServices, UiAdapter, CliState } from './types.js';

// Sanskrit characters for cascade animation
const PERSONALITY_TONES: Record<string, { label: string; instruction: string }> = {
  vanilla: {
    label: 'Vanilla (Standard Professional)',
    instruction: 'Voice/Tone: Maintain a standard, helpful, and professional coding assistant tone. Keep explanations clear, concise, and focused on the codebase.'
  },
  homie: {
    label: 'The Homie (Street-Smart/Hood)',
    instruction: 'Voice/Tone: Talk like a supportive friend from the hood. Use informal language, call the user "cuh", prioritize the grind, and keep it encouraging.'
  },
  savage: {
    label: 'The Savage Senior (Cynical Lead)',
    instruction: 'Voice/Tone: Act like a cynical, grumpy senior developer. Complain about sloppy code, roast bad style choices slightly, but write perfect, high-performance solutions.'
  },
  zen: {
    label: 'The Zen Monk (Minimalist Architect)',
    instruction: 'Voice/Tone: Speak in a calm, philosophical, and minimalist manner. Use short, wise phrases. Advocate for deleting code, avoiding dependencies, and clean designs.'
  },
  terminator: {
    label: 'The Terminator (Max Speed)',
    instruction: 'Voice/Tone: Act as a pure command-line machine. Write absolutely zero conversational text—output ONLY the required code blocks and XML tool tags.'
  }
};

const SYSTEM_INSTRUCTIONS = `<system_persona>
You are Unit01, a directive AI coding assistant designed to build and debug projects in a local sandboxed environment.
Your primary method of action is executing tools via XML tags. Keep your explanations concise, professional, and code-focused.
</system_persona>

<tool_definitions>
You can invoke the following tools by wrapping the command in XML tags. You must write the actual paths (do not use placeholders like "relative_path"):

- To run a shell command:
  <run_command>npm test</run_command>

- To read a file:
  <read_file>src/db.ts</read_file>

- To write or overwrite a new file:
  <write_file path="src/main.ts">console.log("hello");</write_file>

- To search the codebase:
  <search_code>DatabaseSync</search_code>

- To search the web:
  <web_search>recent AI news 2026</web_search>

- To patch a single exact string occurrence in a file:
  <patch_file path="src/main.ts" search="console.log(&quot;hello&quot;);" replace="console.log(&quot;hi&quot;);" />
  Or nested format:
  <patch_file path="src/main.ts">
    <search>console.log("hello");</search>
    <replace>console.log("hi");</replace>
  </patch_file>

- To perform multi-block edits on an existing file:
  <patch_file_blocks path="src/main.ts">
  <<<<<<< ORIGINAL
  console.log("hello");
  =======
  console.log("hi");
  >>>>>>> UPDATED
  </patch_file_blocks>

- To list directory contents directly:
  <list_dir path="src" recursive="false" />

- To view structured git status:
  <git_status />

- To run project compilation/linter diagnostics:
  <diagnostics /> or <diagnostics command="npm run lint" />

- To rename or move a file:
  <move_file source_path="old.py" destination_path="new.py" />

- To ask the developer a question or request path permission:
  <question options="Allow read-write, Allow read-only, Deny">I need access to /path/to/directory to complete this task. Grant access?</question>
</tool_definitions>

<behavioral_rules>
1. Execute only ONE tool at a time.
2. Once you write a tool call tag, stop outputting text immediately. Wait for the tool output to be returned to you in a <tool_output> block. Do NOT write any conversational text, preambles, or introductory explanations (such as "To read the file...", "You can run this command...", etc.) before writing the XML tool tag. Simply output the XML tool tag directly.
3. Do not write placeholders like "relative_path". Write the actual path directly.
4. Before executing any file, ensure it has been written using write_file first. Always use absolute paths.
5. Tool Selection Priority:
   - Use patch_file_blocks as the default tool to edit existing files.
   - Use patch_file for simple, single exact replacements.
   - Use write_file only when creating new files. Never write_file on an existing file.
   - Use move_file to rename or move files. Never use cp + rm or mv in run_command.
   - You MUST use the <question> tool to request path access if you need to access files outside the workspace. Do NOT request path access, ask questions, or clarify requirements via plain conversational text, as the user has no way to grant permissions or respond unless you invoke the <question> tool tag.
6. Complex Task / New Project Workflow:
   - When asked to create a new application, website, game, or implement a large feature, DO NOT write files immediately.
   - First, present a clear architectural plan detailing the files you plan to create/modify and libraries you need. Wait for user approval or feedback.
   - After approval, implement the code incrementally—write or edit only ONE file per turn, starting with the base configuration and core logic.
   - Keep code modular and clean. Separate concerns (e.g., separate UI rendering from core logic) to prevent massive single-file dumps.
7. To access files or directories outside the workspace (such as the home directory), first attempt to access them using filesystem tools (e.g. <list_dir path="\${os.homedir()}" />) or commands. If the tool fails with a PATH_NOT_ALLOWED error, copy the exact path from the error response and immediately request access using the question tool (e.g., <question options="Allow read-write, Allow read-only, Deny">I need access to \${os.homedir()} to complete this task. Grant access?</question>). You MUST use the <question> tool tag; do NOT attempt to request permission or ask for access using plain conversational text.
8. When using the <question> tool to request path permission, always substitute the target path dynamically (do not literally copy "/path/to/directory" from the example; use the actual absolute path you need to access, e.g. "\${os.homedir()}").
9. Web Search & Code Confirmation Flow: When searching the web for code, libraries, or general solutions (using <web_search>), do NOT write files or execute other tools immediately after receiving the search results. First, present the findings and the code inside the chat area (e.g., \'I found this code, it is X lines long, here is how it works...\'). Then, explicitly ask the user what they want to do with the code (e.g., write it to a file, modify it, or explain it), and wait for their input before taking any action on the codebase files.
10. Give me in the Chat Area Rule: If the user asks to see code, write code \'in the chat\', \'show me\', or uses similar phrases requesting visibility in the conversation window, you are strictly prohibited from using <write_file> or <patch_file_blocks> to modify the workspace files. You must only print the code inside markdown code blocks in your chat response. You are only allowed to write or edit workspace files if the user explicitly instructs you to save or write it to a file (e.g., \'write this to src/calculator.py\').
</behavioral_rules>`;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getGitBranch(workspaceRoot: string): string {
  try {
    return execSync('git branch --show-current', { cwd: workspaceRoot, stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return 'main';
  }
}

function detectProjectType(workspaceRoot: string): string | null {
  if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) return 'Node.js';
  if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) return 'Rust';
  if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) return 'Go';
  if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) return 'Python';
  if (fs.existsSync(path.join(workspaceRoot, 'setup.py'))) return 'Python';
  if (fs.existsSync(path.join(workspaceRoot, 'Gemfile'))) return 'Ruby';
  if (fs.existsSync(path.join(workspaceRoot, 'CMakeLists.txt'))) return 'C/C++';
  if (fs.existsSync(path.join(workspaceRoot, 'composer.json'))) return 'PHP';
  return null;
}

interface Unit01Config {
  allowed_paths?: AllowedPath[];
  compact_threshold?: number;
  test_command?: string;
  personality?: string;
  strict_sandbox?: boolean;
}

function loadConfig(workspaceRoot: string): Unit01Config {
  const configPath = path.join(workspaceRoot, 'unit01.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return data || {};
    } catch (e: any) {}
  }
  return {};
}

function hasRepetitionLoop(text: string): boolean {
  const len = text.length;
  const maxChunkSize = Math.min(200, Math.floor(len / 3));
  for (let size = 10; size <= maxChunkSize; size++) {
    const chunk3 = text.slice(-size);
    const chunk2 = text.slice(-2 * size, -size);
    const chunk1 = text.slice(-3 * size, -2 * size);
    if (chunk1 === chunk2 && chunk2 === chunk3) {
      if (/[a-zA-Z]/.test(chunk3) && new Set(chunk3).size > 2) {
        return true;
      }
    }
  }
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length >= 4) {
    const last4 = lines.slice(-4);
    if (last4[0] === last4[1] && last4[1] === last4[2] && last4[2] === last4[3]) {
      const line = last4[0];
      if (line.length >= 3 && /[a-zA-Z]/.test(line) && new Set(line).size > 2) {
        return true;
      }
    }
  }
  return false;
}

async function main() {
  const workspaceRoot = process.cwd();

  // Parse args
  const args = process.argv.slice(2);
  let activeModelArg: string | null = null;
  let nonInteractivePrompt: string | null = null;
  const cliAllowedPaths: AllowedPath[] = [];
  let continueSession = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && i + 1 < args.length) {
      i++;
    } else if (args[i] === '--model' && i + 1 < args.length) {
      activeModelArg = args[i + 1];
      i++;
    } else if (args[i] === '-p' && i + 1 < args.length) {
      nonInteractivePrompt = args[i + 1];
      i++;
    } else if (args[i] === '--allow' && i + 1 < args.length) {
      cliAllowedPaths.push({ path: args[i + 1], mode: 'rw' });
      i++;
    } else if (args[i] === '--allow-read' && i + 1 < args.length) {
      cliAllowedPaths.push({ path: args[i + 1], mode: 'ro' });
      i++;
    } else if (args[i] === '-c' || args[i] === '--continue') {
      continueSession = true;
    }
  }

  const models = await ollama.listModels();
  if (models.length === 0) {
    console.error('No local Ollama models detected. Ensure Ollama is running.');
    process.exit(1);
  }

  const chatModels = models.filter(m => !m.name.toLowerCase().includes('embed'));
  let activeModel = (chatModels.length > 0 ? chatModels[0] : models[0]).name;
  if (activeModelArg) {
    const matchIndex = models.findIndex(m => m.name === activeModelArg);
    if (matchIndex !== -1) activeModel = models[matchIndex].name;
  }

  let contextLimit = await ollama.getContextLimit(activeModel);
  let thinkingEnabled = true;

  const config = loadConfig(workspaceRoot);
  let activePersonality = config.personality || 'vanilla';
  const rawAllowed = [...(config.allowed_paths || []), ...cliAllowedPaths];
  const resolvedAllowedPaths: AllowedPath[] = [];
  for (const item of rawAllowed) {
    let resolvedPath = item.path;
    if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
      resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
    }
    resolvedAllowedPaths.push({
      path: path.resolve(resolvedPath),
      mode: item.mode
    });
  }

  const state: CliState = {
    lastWrittenFile: null,
    activeAllowedPaths: resolvedAllowedPaths,
    isNonInteractive: !!nonInteractivePrompt
  };

  let compactThreshold = 0.8;
  if (config.compact_threshold !== undefined) {
    compactThreshold = config.compact_threshold;
  }

  let sessionId: string = crypto.randomUUID();
  let autopilotEnabled = false;
  const sessionStartTime = Date.now();
  let lastInputTokens = 0;
  let pendingCompaction = false;
  const conversationHistory: { role: string; content: string }[] = [];

  const indexer = new DirectiveIndexer(workspaceRoot);
  await indexer.initialize({ silent: true });

  try {
    const { indexMissingEmbeddings } = await import('../pro/search/index.js');
    await indexMissingEmbeddings(indexer.db, true);
  } catch (e) {}

  const filesCount = indexer.db.getAllFiles().length;

  const sandbox = new DirectiveSandbox(
    workspaceRoot,
    state.activeAllowedPaths,
    () => {},
    config.strict_sandbox || false
  );
  await sandbox.initialize([], { silent: true });

  const sessionStore = new SessionStore(workspaceRoot);
  const gitBranch = getGitBranch(workspaceRoot);
  const projectType = detectProjectType(workspaceRoot);

  const existingSessions = sessionStore.list(workspaceRoot).filter(s => s.id !== sessionId);
  const isFirstRun = !fs.existsSync(path.join(workspaceRoot, 'unit01.json')) && existingSessions.length === 0;

  let latestSession: { relTime: string; label: string } | null = null;
  if (existingSessions.length > 0) {
    const latest = existingSessions[0];
    const diff = Date.now() - latest.lastUpdatedAt;
    let relTime = 'just now';
    if (diff > 60000) {
      const mins = Math.floor(diff / 60000);
      relTime = `${mins} minute${mins > 1 ? 's' : ''} ago`;
    }
    const cleanMsg = latest.firstMessage.replace(/\r?\n/g, ' ').trim();
    latestSession = {
      relTime,
      label: cleanMsg.length > 60 ? cleanMsg.substring(0, 60) + '...' : cleanMsg || '(empty session)'
    };
  }

  const runCompaction = async (ui: UiAdapter, isAuto: boolean): Promise<boolean> => {
    if (conversationHistory.length < 3) return false;
    const activeRepoMap = indexer.getRepoMap();
    const activeChanges = indexer.getRecentChanges();
    const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
    const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
    const pct = Math.round((totalTokens / contextLimit) * 100);

    let messagesToSummarize = [...conversationHistory];
    const currentPct = totalTokens / contextLimit;
    if (currentPct > 0.60) {
      const countToKeep = Math.max(1, Math.floor(conversationHistory.length * 0.60));
      messagesToSummarize = conversationHistory.slice(-countToKeep);
    }

    const summaryPrompt = `Summarise this conversation into a concise but complete technical brief. Include file edits and commands ran.`;
    const summarisationPayload = [...messagesToSummarize, { role: 'user', content: summaryPrompt }];

    try {
      const chatResult = await ollama.chatStream(
        activeModel,
        summarisationPayload,
        contextLimit,
        () => {},
        new AbortController().signal
      );
      const summaryContent = chatResult.content.trim();
      if (!summaryContent) throw new Error('Empty summary');

      conversationHistory.length = 0;
      conversationHistory.push({
        role: 'system',
        content: `[COMPACTED CONTEXT — summarised at ${new Date().toISOString()}]\n\n${summaryContent}`
      });

      const newHistoryLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
      const newTotal = systemPromptLength + newHistoryLength;
      const saved = totalTokens - newTotal;
      lastInputTokens = newTotal;
      const newPct = Math.round((newTotal / contextLimit) * 100);

      ui.printSystemMessage('info', `context compacted  ·  ${pct}% → ${newPct}%  ·  saved ${saved} tokens`);
      return true;
    } catch (err: any) {
      ui.printSystemMessage('warn', `Compaction failed: ${err.message}`);
      return false;
    }
  };

  const resumeSession = async (ui: UiAdapter, sessionData: SessionData) => {
    conversationHistory.length = 0;
    conversationHistory.push(...sessionData.conversationHistory);
    activeModel = sessionData.activeModel;
    contextLimit = await ollama.getContextLimit(activeModel);
    sessionId = sessionData.id;
    lastInputTokens = 0;
    ui.printSystemMessage('info', `Resumed session successfully.`);
  };

  let activeAbortController: AbortController | null = null;

  // The main handleInput orchestrator
  const handleInput = async (input: string, ui: UiAdapter) => {
    try {
      await handleInputInternal(input, ui);
    } finally {
      if (state.isNonInteractive) {
        try { indexer.close(); } catch (e) {}
        try { sandbox.stop(); } catch (e) {}
        setTimeout(() => {
          ui.exit(0);
        }, 100);
      }
    }
  };

  const handleInputInternal = async (input: string, ui: UiAdapter) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      if (command === '/exit' || command === '/quit') {
        indexer.close();
        sandbox.stop();
        ui.exit(0);
        return;
      }

      if (command === '/clear') {
        conversationHistory.length = 0;
        lastInputTokens = 0;
        ui.printSystemMessage('info', 'Conversation history cleared.');
        return;
      }

      if (command === '/compact') {
        await runCompaction(ui, false);
        return;
      }

      if (command === '/sessions') {
        const sessions = sessionStore.list(workspaceRoot).filter(s => s.id !== sessionId);
        if (sessions.length === 0) {
          ui.printSystemMessage('info', 'No previous sessions found.');
          return;
        }
        const sessionOptions = sessions.map(s => `Session · ${s.messageCount} messages · "${s.firstMessage.slice(0, 40)}"`);
        const chosenIdx = await ui.interactiveSelect('Select session to resume:', sessionOptions);
        if (chosenIdx !== -1) {
          await resumeSession(ui, sessions[chosenIdx]);
        }
        return;
      }

      if (command === '/preview') {
        if (state.lastWrittenFile) {
          ui.showDiff(state.lastWrittenFile.original, state.lastWrittenFile.content, getLanguageFromFilename(state.lastWrittenFile.filePath), state.lastWrittenFile.filePath);
        } else {
          ui.printSystemMessage('info', 'No files modified in this session yet.');
        }
        return;
      }

      if (command === '/status') {
        const activeRepoMap = indexer.getRepoMap();
        const activeChanges = indexer.getRecentChanges();
        const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
        const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
        const ratioPct = Math.round(Math.min(totalTokens / contextLimit, 1.0) * 100);

        ui.addTextOutput(`\n  model:     ${activeModel}\n  context:   ${totalTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens (${ratioPct}%)\n  branch:    ${gitBranch}\n  files:     ${filesCount}\n`);
        return;
      }

      if (command === '/models') {
        const options = models.map(m => {
          const activeIndicator = m.name === activeModel ? ' (active)' : '';
          return `${m.name}${activeIndicator}`;
        });
        const chosenIdx = await ui.interactiveSelect('Select Active Model:', options);
        if (chosenIdx !== -1) {
          activeModel = models[chosenIdx].name;
          contextLimit = await ollama.getContextLimit(activeModel);
          ui.printSystemMessage('info', `Switched to active model: ${activeModel}`);
        }
        return;
      }

      if (command === '/thinking') {
        const chosenIdx = await ui.interactiveSelect('Model Thinking Mode:', [
          `Enable Thinking  ${thinkingEnabled ? '✓' : ''}`,
          `Disable Thinking ${!thinkingEnabled ? '✓' : ''}`
        ]);
        if (chosenIdx === 0) {
          thinkingEnabled = true;
          ui.printSystemMessage('info', 'Model thinking enabled.');
        } else if (chosenIdx === 1) {
          thinkingEnabled = false;
          ui.printSystemMessage('info', 'Model thinking disabled.');
        }
        return;
      }

      if (command === '/autopilot') {
        const chosenIdx = await ui.interactiveSelect('Autopilot Mode:', [
          `Enable Autopilot (Plan-Code-Test-Healing Loop)  ${autopilotEnabled ? '✓' : ''}`,
          `Disable Autopilot ${!autopilotEnabled ? '✓' : ''}`
        ]);
        if (chosenIdx === 0) {
          autopilotEnabled = true;
          ui.printSystemMessage('info', '🤖 Autopilot enabled.');
        } else if (chosenIdx === 1) {
          autopilotEnabled = false;
          ui.printSystemMessage('info', '🤖 Autopilot disabled.');
        }
        return;
      }

      if (command === '/personality') {
        const keys = Object.keys(PERSONALITY_TONES);
        const options = keys.map(k => {
          const activeIndicator = k === activePersonality ? ' (active)' : '';
          return `${PERSONALITY_TONES[k].label}${activeIndicator}`;
        });
        const chosenIdx = await ui.interactiveSelect('Select Personality:', options);
        if (chosenIdx !== -1) {
          activePersonality = keys[chosenIdx];
          ui.printSystemMessage('info', `Switched to personality: ${PERSONALITY_TONES[activePersonality].label}`);
        }
        return;
      }

      if (command === '/changes') {
        const changes = indexer.getRecentChanges();
        ui.addTextOutput('\n' + (changes || 'No recent changes.') + '\n');
        return;
      }

      if (command === '/undo') {
        const dbBackup = indexer.db.db.prepare('SELECT original_path FROM shadow_backups LIMIT 1').get() as { original_path: string } | undefined;
        if (dbBackup) {
          const restoredPath = dbBackup.original_path;
          const success = indexer.undoWrite(restoredPath);
          if (success) {
            sandbox.clearLoopHistory();
            ui.printSystemMessage('info', `Reverted changes for: ${path.basename(restoredPath)}`);
          } else {
            ui.printSystemMessage('error', `Failed to restore backup for ${restoredPath}`);
          }
        } else {
          ui.printSystemMessage('info', 'No backups found to undo.');
        }
        return;
      }

      if (command === '/files') {
        const allFiles = indexer.db.getAllFiles();
        let out = `\nIndexed Files (${allFiles.length}):\n`;
        allFiles.forEach(f => {
          const rel = path.relative(workspaceRoot, f.path);
          out += `  - ${rel} (${(f.size / 1024).toFixed(1)} KB)\n`;
        });
        ui.addTextOutput(out);
        return;
      }

      if (command === '/reindex') {
        ui.printSystemMessage('info', 'Re-scanning workspace and rebuilding index...');
        await indexer.initialize();
        ui.printSystemMessage('info', 'Index successfully rebuilt.');
        return;
      }

      if (command === '/search') {
        if (!arg) {
          ui.printSystemMessage('error', 'Usage: /search <query>');
          return;
        }
        const results = indexer.search(arg);
        let out = `\nFound ${results.length} matches:\n`;
        results.slice(0, 5).forEach(r => {
          out += `  - ${r.relpath} (line ${r.start_line}-${r.end_line})\n`;
        });
        ui.addTextOutput(out);
        return;
      }

      ui.printSystemMessage('error', `Unknown command: ${command}`);
      return;
    }

    conversationHistory.push({ role: 'user', content: trimmed });

    let loopDepth = 0;
    const runAgentLoop = async () => {
      loopDepth++;
      if (loopDepth > 15) {
        ui.printSystemMessage('guard', 'Maximum tool iteration depth of 15 reached.');
        return;
      }

      const currentRepoMap = indexer.getRepoMap();
      const currentChanges = indexer.getRecentChanges();
      const toneBlock = PERSONALITY_TONES[activePersonality]?.instruction || PERSONALITY_TONES['vanilla'].instruction;
      
      const systemMessage = {
        role: 'system',
        content: `${SYSTEM_INSTRUCTIONS}\n\n<conversational_tone>\n${toneBlock}\n</conversational_tone>\n\n[Active Repository Map]\n${currentRepoMap}\n\n${currentChanges}`
      };

      const activePayload = [systemMessage, ...conversationHistory];

      let streamAccumulator = '';
      ui.startStreaming();

      try {
        activeAbortController = new AbortController();
        const chatResult = await ollama.chatStream(
          activeModel,
          activePayload,
          contextLimit,
          (chunk) => {
            streamAccumulator += chunk;
            if (hasRepetitionLoop(streamAccumulator)) {
              throw new Error('REPETITION_LOOP');
            }
            ui.onStreamChunk(chunk);
          },
          activeAbortController.signal
        );
        activeAbortController = null;

        ui.endStreaming();
        const modelResponse = chatResult.content;
        ui.printModelResponse(modelResponse, thinkingEnabled);
        lastInputTokens = chatResult.usage.input_tokens;

        if (chatResult.usage.input_tokens / contextLimit >= compactThreshold) {
          pendingCompaction = true;
        }

        // Handle tools
        const toolResult = await handleToolCalls(modelResponse, sandbox, indexer, ui, state);

        // Autopilot test-healing loop
        if (autopilotEnabled && toolResult.toolRun && (modelResponse.includes('<patch_file') || modelResponse.includes('<write_file'))) {
          try {
            const { StructuredBuildPipeline } = await import('../pro/autopilot/pipeline.js');
            const testCommand = config.test_command || 'npm test';
            const pipeline = new StructuredBuildPipeline(workspaceRoot, testCommand, 5);
            ui.printSystemMessage('info', `🤖 [Autopilot] Verifying with test command: "${testCommand}"...`);
            const result = await pipeline.executePipeline(
              async () => {},
              async (errorLog) => {
                toolResult.nextPrompt = `<tool_output>\nVerification command failed:\n${errorLog}\n</tool_output>`;
                return true;
              }
            );
            if (!result.success) {
              ui.printSystemMessage('error', '🤖 [Autopilot] Verification failed.');
            }
          } catch (e) {}
        }

        if (toolResult.toolRun) {
          conversationHistory.push({ role: 'assistant', content: modelResponse });
          conversationHistory.push({ role: 'user', content: toolResult.nextPrompt });
          await runAgentLoop();
        } else {
          conversationHistory.push({ role: 'assistant', content: modelResponse });
          if (pendingCompaction) {
            await runCompaction(ui, true);
            pendingCompaction = false;
          }
          ui.returnToPrompt();
        }
      } catch (err: any) {
        ui.endStreaming();
        ui.printSystemMessage('error', `Generation failed: ${err.message}`);
        ui.returnToPrompt();
      }
    };

    await runAgentLoop();
  };

  // Boot Ink App
  const services: CoreServices = {
    workspaceRoot,
    activeModel,
    contextLimit,
    filesCount,
    gitBranch,
    projectType,
    isFirstRun,
    thinkingEnabled,
    latestSession,
    nonInteractivePrompt,
    abortStreaming: () => {
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
    },
    handleInput
  };

  render(<App services={services} />);
}

main().catch(err => {
  console.error('Failed to boot Unit01 CLI:', err);
});
