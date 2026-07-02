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
import { DirectiveSandbox, redactSecrets } from '../core/security/sandbox.js';
import { ollama } from '../core/llm/client.js';
import { buildRepoMap } from '../core/indexer/repomap.js';
import { AllowedPath } from '../core/security/types.js';
import { SessionStore, SessionData, runStalenessCheck } from '../core/session/index.js';
import { handleToolCalls } from './commands.js';
import { ProjectMemoryStore } from '../pro/memory/index.js';
import { AuditLogStore } from '../pro/audit/index.js';
import {
  themePrimary,
  themeOrange,
  themeAccent,
  themeBorder,
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

const OLLAMA_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edits or writes a file using search/replace blocks or whole content.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Relative path of the file to edit or create.' },
          content: { type: 'string', description: 'The file contents, or ORIGINAL/UPDATED blocks for patching.' }
        },
        required: ['filePath', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads the complete text content of a file in the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Executes a command inside the sandboxed environment (running tests, builds, linting).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line string to run.' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Searches codebase, web pages, or lists directory structure.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['code', 'web', 'files'], description: 'Scope of the search.' },
          query: { type: 'string', description: 'Search term, web query, or file filter query.' },
          pathVal: { type: 'string', description: 'Optional directory path for files scope.' }
        },
        required: ['scope', 'query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'view_outline',
      description: 'Retrieves structural class, method, or function outline of a file to save tokens.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to the file.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Asks the user a clarifying question or requests path mount permissions.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question text.' },
          options: { type: 'string', description: 'Optional comma-separated list of choice options.' }
        },
        required: ['question']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: 'Renames or moves a file.',
      parameters: {
        type: 'object',
        properties: {
          sourcePath: { type: 'string', description: 'Source path.' },
          destinationPath: { type: 'string', description: 'Destination path.' }
        },
        required: ['sourcePath', 'destinationPath']
      }
    }
  }
];

function getToolCallFingerprint(tc: any): string {
  const name = tc.function?.name || '';
  const args = tc.function?.arguments || {};
  const sortedArgs: Record<string, any> = {};
  Object.keys(args).sort().forEach(k => {
    sortedArgs[k] = args[k];
  });
  return `${name}:${JSON.stringify(sortedArgs)}`;
}

function getXmlToolCallFingerprint(text: string): string {
  const match = /<([a-zA-Z_][a-zA-Z0-9_\-]*)([^>]*)>([\s\S]*?)(?:<\/\1>|$)/.exec(text);
  if (match) {
    const name = match[1];
    const attrs = match[2].trim();
    const content = match[3].trim();
    return `xml:${name}:${attrs}:${content}`;
  }
  return '';
}

function formatToolCallToXml(tc: any): string {
  const name = tc.function?.name;
  const args = tc.function?.arguments || {};
  switch (name) {
    case 'edit_file':
      return `<edit_file path="${args.filePath || args.path}">${args.content || ''}</edit_file>`;
    case 'read_file':
      return `<read_file path="${args.path || args.filePath}" />`;
    case 'run_command':
      return `<run_command>${args.command}</run_command>`;
    case 'search':
      return `<search scope="${args.scope || 'code'}"${args.pathVal ? ` path="${args.pathVal}"` : ''}>${args.query || ''}</search>`;
    case 'view_outline':
      return `<view_outline path="${args.path}" />`;
    case 'ask_user':
      return `<ask_user${args.options ? ` options="${args.options}"` : ''}>${args.question}</ask_user>`;
    case 'move_file':
      return `<move_file source_path="${args.sourcePath}" destination_path="${args.destinationPath}" />`;
    default:
      return '';
  }
}

const SYSTEM_INSTRUCTIONS = `<system_persona>
You are Unit01, a directive AI coding assistant designed to build and debug projects in a local sandboxed environment.
Your primary method of action is executing tools via XML tags. Keep your explanations concise, professional, and code-focused.
</system_persona>

<tool_definitions>
You can invoke the following tools by wrapping the command in XML tags. You must write the actual paths (do not use placeholders like "relative_path"):

- To read a file:
  <read_file>src/db.ts</read_file>

- To edit a file (handles creating, rewriting, or patching using ORIGINAL/UPDATED block hunks):
  To create a new file or rewrite one entirely:
  <edit_file path="src/main.ts">console.log("hello");</edit_file>
  To patch an existing file:
  <edit_file path="src/main.ts">
  <<<<<<< ORIGINAL
  console.log("hello");
  =======
  console.log("hi");
  >>>>>>> UPDATED
  </edit_file>

- To run a shell command (running tests, builds, linting, etc.):
  <run_command>npm test</run_command>

- To search (codebase contents, web pages, or directory file structure):
  To search text in codebase:
  <search scope="code">DatabaseSync</search>
  To search the web:
  <search scope="web">recent AI news 2026</search>
  To find files or list directory structure:
  <search scope="files" path="src">*.ts</search> (or query can be left empty: <search scope="files" path="src" />)

- To view the structural outlines (classes/methods/functions) of a file without reading the whole code:
  <view_outline path="src/cli/index.tsx" />

- To ask the developer a question or request permission to mount a path:
  <ask_user options="Allow read-write, Allow read-only, Deny">I need access to /path/to/directory. Grant access?</ask_user>

- To rename or move a file:
  <move_file source_path="old.py" destination_path="new.py" />
</tool_definitions>

<behavioral_rules>
1. Execute only ONE tool at a time.
2. Once you write a tool call tag, stop outputting text immediately. Wait for the tool output to be returned to you in a <tool_output> block. Do NOT write any conversational text, preambles, or introductory explanations (such as "To read the file...", "You can run this command...", etc.) before writing the XML tool tag. Simply output the XML tool tag directly.
3. Do not write placeholders like "relative_path". Write the actual path directly.
4. Before executing any file, ensure it has been written/edited using edit_file first. Always use absolute paths.
5. Tool Selection Priority:
   - Use view_outline to check symbol declarations and line numbers before reading a large file.
   - Use edit_file as the default tool to modify or create files. Never use write_file or patch_file.
   - Use search for looking up text in the codebase, searching the web, or locating files.
   - Use move_file to rename or move files. Never use cp + rm or mv in run_command.
   - You MUST use the <ask_user> tool to request path access if you need to access files outside the workspace. Do NOT request path access, ask questions, or clarify requirements via plain conversational text, as the user has no way to grant permissions or respond unless you invoke the <ask_user> tool tag.
6. Complex Task / New Project Workflow:
   - When asked to create a new application, website, game, or implement a large feature, DO NOT write files immediately.
   - First, present a clear architectural plan detailing the files you plan to create/modify and libraries you need. Wait for user approval or feedback.
   - After approval, implement the code incrementally—write or edit only ONE file per turn, starting with the base configuration and core logic.
   - Keep code modular and clean. Separate concerns (e.g., separate UI rendering from core logic) to prevent massive single-file dumps.
7. To access files or directories outside the workspace (such as the home directory), first attempt to access them using filesystem tools (e.g. <search scope="files" path="/home/user" />) or commands. If the tool fails with a PATH_NOT_ALLOWED error, copy the exact path from the error response and immediately request access using the ask_user tool (e.g., <ask_user options="Allow read-write, Allow read-only, Deny">I need access to \${os.homedir()} to complete this task. Grant access?</ask_user>). You MUST use the <ask_user> tool tag; do NOT attempt to request permission or ask for access using plain conversational text.
8. When using the <ask_user> tool to request path permission, always substitute the target path dynamically (do not literally copy "/path/to/directory" from the example; use the actual absolute path you need to access, e.g. "\${os.homedir()}").
9. Web Search & Code Confirmation Flow: When searching the web for code, libraries, or general solutions (using <search scope="web">), do NOT write files or execute other tools immediately after receiving the search results. First, present the findings and the code inside the chat area (e.g., 'I found this code, it is X lines long, here is how it works...'). Then, explicitly ask the user what they want to do with the code (e.g., write it to a file, modify it, or explain it), and wait for their input before taking any action on the codebase files.
10. Give me in the Chat Area Rule: If the user asks to see code, write code 'in the chat', 'show me', or uses similar phrases requesting visibility in the conversation window, you are strictly prohibited from using <edit_file> to modify the workspace files. You must only print the code inside markdown code blocks in your chat response. You are only allowed to write or edit workspace files if the user explicitly instructs you to save or write it to a file (e.g., 'write this to src/calculator.py').
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
  const minSequenceSize = 20;
  const maxChunkSize = Math.min(200, Math.floor(len / 3));
  
  if (len < minSequenceSize * 3) {
    return false;
  }

  for (let size = minSequenceSize; size <= maxChunkSize; size++) {
    const chunk3 = text.slice(-size);
    const chunk2 = text.slice(-2 * size, -size);
    const chunk1 = text.slice(-3 * size, -2 * size);
    if (chunk1 === chunk2 && chunk2 === chunk3) {
      const lettersCount = (chunk3.match(/[a-zA-Z]/g) || []).length;
      const uniqueChars = new Set(chunk3).size;
      
      if (uniqueChars >= 5 && lettersCount / size >= 0.35) {
        return true;
      }
    }
  }

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length >= 5) {
    const last5 = lines.slice(-5);
    const first = last5[0];
    const allMatch = last5.every(l => l === first);
    if (allMatch) {
      const uniqueChars = new Set(first).size;
      const lettersCount = (first.match(/[a-zA-Z]/g) || []).length;
      if (first.length >= 8 && uniqueChars >= 4 && lettersCount >= 3) {
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
  const conversationHistory: any[] = [];

  const recentToolCallsFingerprints: string[] = [];
  const MAX_FINGERPRINTS = 10;
  let useNativeTools = false;
  // Enforce XML tags exclusively as Ollama's native tool parsing is unstable and causes empty/silent failures on first turns
  /*
  try {
    useNativeTools = await ollama.checkModelToolsCapability(activeModel);
  } catch (e) {}
  */

  const indexer = new DirectiveIndexer(workspaceRoot);
  await indexer.initialize({ silent: true });

  const memoryStore = new ProjectMemoryStore(indexer.db);

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

    const summaryPrompt = `You are compacting the conversation history. Analyze the conversation history so far and output a response wrapped in a single <compaction_response> tag. Inside, provide the following three sections:

1. <summary>: A concise technical brief of the edits made, files created, and commands run.
2. <decisions>: List any architectural choices made (e.g. database choice, library choice, authentication flow, file structure). Format each as: "- [category] Summary (Rationale: Rationale description)". Use categories: database, auth, styles, conventions, other.
3. <conventions>: List any specific coding guidelines, patterns, naming conventions, or rules the user requested or established. Format each as: "- [key]: \\"Pattern details\\"".

Example output format:
<compaction_response>
<summary>
Integrated native tools and upgraded loop detection in index.tsx.
</summary>
<decisions>
- [conventions] Consolidated toolset to 6 core tools (Rationale: Simplify native JSON parameter schemas and reduce validation errors).
</decisions>
<conventions>
- [edit_file_priority]: "Always prefer edit_file over write_file for all edits"
</conventions>
</compaction_response>`;

    const summarisationPayload = [...messagesToSummarize, { role: 'user', content: summaryPrompt }];

    try {
      const chatResult = await ollama.chatStream(
        activeModel,
        summarisationPayload,
        contextLimit,
        () => {},
        new AbortController().signal
      );
      
      const contentText = chatResult.content;
      const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(contentText);
      const summaryContent = summaryMatch ? summaryMatch[1].trim() : contentText.trim();
      
      if (!summaryContent) throw new Error('Empty summary');

      // Extract decisions
      const decisionsMatch = /<decisions>([\s\S]*?)<\/decisions>/.exec(contentText);
      if (decisionsMatch) {
        const lines = decisionsMatch[1].split('\n');
        for (const line of lines) {
          const match = /-\s*\[(database|auth|styles|conventions|other)\]\s*(.*?)\s*\(Rationale:\s*(.*?)\)/i.exec(line);
          if (match) {
            const [, category, summary, rationale] = match;
            try {
              memoryStore.logDecision({
                category: category.toLowerCase() as any,
                summary: summary.trim(),
                rationale: rationale.trim(),
                context_files: []
              });
            } catch (e) {}
          }
        }
      }

      // Extract conventions
      const conventionsMatch = /<conventions>([\s\S]*?)<\/conventions>/.exec(contentText);
      if (conventionsMatch) {
        const lines = conventionsMatch[1].split('\n');
        for (const line of lines) {
          const match = /-\s*\[(.*?)\]:\s*"(.*?)"/.exec(line);
          if (match) {
            const [, key, pattern] = match;
            try {
              memoryStore.upsertConvention(key.trim(), pattern.trim());
            } catch (e) {}
          }
        }
      }

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

      ui.printSystemMessage('info', `context compacted & memory distilled  ·  ${pct}% → ${newPct}%  ·  saved ${saved} tokens`);
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
    ui.updateStatus(activeModel, '0', gitBranch);
    ui.populateHistory(sessionData.conversationHistory);
    ui.printSystemMessage('info', `Resumed session successfully.`);
  };

  let activeAbortController: AbortController | null = null;

  // The main handleInput orchestrator
  const handleInput = async (input: string, ui: UiAdapter) => {
    try {
      await handleInputInternal(input, ui);
      // Auto-save session after processing a user turn
      if (conversationHistory.length > 0) {
        sessionStore.save(sessionId, {
          startedAt: sessionStartTime,
          activeModel,
          conversationHistory
        });
      }
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
        if (conversationHistory.length > 0) {
          sessionStore.save(sessionId, {
            startedAt: sessionStartTime,
            activeModel,
            conversationHistory
          });
        }
        indexer.close();
        sandbox.stop();
        ui.exit(0);
        return;
      }

      if (command === '/clear') {
        conversationHistory.length = 0;
        lastInputTokens = 0;
        sessionId = crypto.randomUUID(); // Start new session
        ui.clear();
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
        const chosenIdx = await ui.interactiveSelect('Select Session:', sessionOptions);
        if (chosenIdx !== -1) {
          const selectedSession = sessions[chosenIdx];
          const actionIdx = await ui.interactiveSelect('Session Action:', [
            'Resume',
            'Rename',
            'Delete',
            'Cancel'
          ]);

          if (actionIdx === 0) {
            await resumeSession(ui, selectedSession);
          } else if (actionIdx === 1) {
            const newName = await ui.interactiveInput('Enter new session name:', selectedSession.firstMessage);
            if (newName.trim()) {
              sessionStore.rename(selectedSession.id, newName.trim());
              ui.printSystemMessage('info', 'Session renamed successfully.');
            }
          } else if (actionIdx === 2) {
            sessionStore.delete(selectedSession.id);
            ui.printSystemMessage('info', 'Session deleted successfully.');
          }
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

        const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  system status');
        const divider = themeBorder('────────────────────────────────────────');
        
        const tildify = (absolutePath: string) => {
          const home = os.homedir();
          if (absolutePath.startsWith(home)) {
            return '~' + absolutePath.slice(home.length);
          }
          return absolutePath;
        };

        const out = [
          '',
          `  ${divider}`,
          `  ${headerLine}`,
          `  ${divider}`,
          `  ${chalk.hex('#64748B')('model'.padEnd(11))}${activeModel}`,
          `  ${chalk.hex('#64748B')('context'.padEnd(11))}${totalTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens  (${ratioPct}%)`,
          `  ${chalk.hex('#64748B')('workspace'.padEnd(11))}${tildify(workspaceRoot)}`,
          `  ${chalk.hex('#64748B')('branch'.padEnd(11))}${gitBranch}`,
          `  ${chalk.hex('#64748B')('files'.padEnd(11))}${filesCount}`,
          ''
        ].join('\n');

        ui.addTextOutput(out);
        return;
      }

      if (command === '/usage') {
        const activeRepoMap = indexer.getRepoMap();
        const activeChanges = indexer.getRecentChanges();
        const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
        const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
        const ratioPct = Math.round(Math.min(totalTokens / contextLimit, 1.0) * 100);

        const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  context window');
        const divider = themeBorder('────────────────────────────────────────');

        let fillColor = '#F59E0B'; // gold
        if (ratioPct >= 60 && ratioPct < 80) {
          fillColor = '#D97706'; // amber
        } else if (ratioPct >= 80) {
          fillColor = '#F87171'; // rose
        }

        const filledCount = Math.round((ratioPct / 100) * 20);
        const emptyCount = 20 - filledCount;
        const filledStr = chalk.hex(fillColor)('█'.repeat(filledCount));
        const emptyStr = chalk.hex('#64748B')('░'.repeat(emptyCount));

        const labelStyle = chalk.hex('#64748B').dim;
        const percentStr = labelStyle(`${ratioPct}%`);
        const midDot = labelStyle('·');
        const tokensStr = labelStyle(`${Math.round(totalTokens / 1000)}k / ${Math.round(contextLimit / 1000)}k`);

        const out = [
          '',
          `  ${headerLine}`,
          `  ${divider}`,
          `  [${filledStr}${emptyStr}]  ${percentStr}  ${midDot}  ${tokensStr}`,
          ''
        ].join('\n');

        ui.addTextOutput(out);
        return;
      }

      if (command === '/help') {
        const headerLine = chalk.hex('#C084FC')('◈ unit01  ·  help');
        const divider = themeBorder('────────────────────────────────────────');

        const helpItems = [
          { cmd: '/models', desc: 'switch the active model' },
          { cmd: '/thinking', desc: 'toggle reasoning blocks' },
          { cmd: '/status', desc: 'system info' },
          { cmd: '/usage', desc: 'context window usage' },
          { cmd: '/sessions', desc: 'browse saved sessions' },
          { cmd: '/compact', desc: 'compress context' },
          { cmd: '/clear', desc: 'clear conversation' },
          { cmd: '/export', desc: 'export session' },
          { cmd: '/help', desc: 'show this menu' }
        ];

        const out = [
          '',
          `  ${divider}`,
          `  ${headerLine}`,
          `  ${divider}`,
          ...helpItems.map(item => {
            const cmdColored = chalk.hex('#C084FC')(item.cmd.padEnd(14));
            const descColored = chalk.hex('#64748B')(item.desc);
            return `  ${cmdColored}${descColored}`;
          }),
          ''
        ].join('\n');

        ui.addTextOutput(out);
        return;
      }

      if (command === '/export') {
        if (conversationHistory.length === 0) {
          ui.printSystemMessage('error', 'Nothing to export — conversation history is empty.');
          return;
        }

        const homeDir = os.homedir();
        const sessionDir = path.join(homeDir, 'ruthen-sessions');

        // Ensure ruthen-sessions directory exists
        if (!fs.existsSync(sessionDir)) {
          try {
            fs.mkdirSync(sessionDir, { recursive: true });
          } catch (e: any) {
            ui.printSystemMessage('error', `Failed to create sessions directory: ${e.message}`);
          }
        }

        // YYYY-MM-DD
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        // Find first user message (not tool output)
        const firstUserMsg = conversationHistory.find(m => m.role === 'user' && !m.content.includes('<tool_output>'));
        let suffix = '';
        if (firstUserMsg) {
          let sanitised = firstUserMsg.content.toLowerCase();
          sanitised = sanitised.replace(/\s+/g, '-');
          sanitised = sanitised.replace(/[^a-z0-9\-]/g, '');
          sanitised = sanitised.replace(/-+/g, '-');
          sanitised = sanitised.replace(/^-+|-+$/g, '');
          sanitised = sanitised.substring(0, 40);
          sanitised = sanitised.replace(/-+$/g, '');
          
          if (sanitised.length >= 3) {
            suffix = sanitised;
          }
        }

        if (!suffix) {
          const hh = String(now.getHours()).padStart(2, '0');
          const min = String(now.getMinutes()).padStart(2, '0');
          const ss = String(now.getSeconds()).padStart(2, '0');
          suffix = `${hh}-${min}-${ss}`;
        }

        const defaultPath = path.join(sessionDir, `${dateStr}-${suffix}.md`);

        let targetPath = arg.trim();
        if (!targetPath) {
          targetPath = defaultPath;
        } else {
          if (targetPath.startsWith('~/')) {
            targetPath = path.join(homeDir, targetPath.slice(2));
          } else {
            targetPath = path.resolve(workspaceRoot, targetPath);
          }
        }

        let finalPath = targetPath;
        if (fs.existsSync(finalPath)) {
          const overwriteIdx = await ui.interactiveSelect(`File already exists at ${finalPath}. Overwrite?`, [
            'No (Generate unique filename)',
            'Yes (Overwrite)',
          ]);

          if (overwriteIdx !== 1) { // 1 is Yes
            const ext = path.extname(finalPath);
            const dir = path.dirname(finalPath);
            const base = path.basename(finalPath, ext);
            let counter = 1;
            while (true) {
              const candidate = path.join(dir, `${base}-${counter}${ext}`);
              if (!fs.existsSync(candidate)) {
                finalPath = candidate;
                break;
              }
              counter++;
            }
          }
        }

        interface FileMod {
          file: string;
          action: 'created' | 'modified' | 'moved';
          toolUsed: string;
          edits: number;
        }

        const fileMods = new Map<string, FileMod>();

        function addOrMergeFileMod(file: string, action: 'created' | 'modified' | 'moved', toolUsed: string) {
          const normalized = path.normalize(file);
          const existing = fileMods.get(normalized);
          if (existing) {
            existing.edits += 1;
            if (existing.action !== 'created' && action === 'created') {
              existing.action = 'created';
            }
            existing.toolUsed = toolUsed;
          } else {
            fileMods.set(normalized, {
              file: normalized,
              action,
              toolUsed,
              edits: 1
            });
          }
        }

        for (const msg of conversationHistory) {
          if (msg.role !== 'assistant') continue;
          const content = msg.content || '';

          // XML tags parsing
          const writeAttrRegex = /<write_file\s+(?:relative_)?path=["']([^"']+)["']/g;
          let match;
          while ((match = writeAttrRegex.exec(content)) !== null) {
            addOrMergeFileMod(match[1], 'created', 'write_file');
          }

          const writeTagRegex = /<write_file\s*>([\s\S]*?)(?:<\/write_file>|$)/g;
          while ((match = writeTagRegex.exec(content)) !== null) {
            const lines = match[1].trim().split('\n');
            if (lines.length > 0 && lines[0].trim()) {
              addOrMergeFileMod(lines[0].trim(), 'created', 'write_file');
            }
          }

          const editAttrRegex = /<edit_file\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/edit_file>|$)/g;
          while ((match = editAttrRegex.exec(content)) !== null) {
            const pathVal = match[1];
            const innerContent = match[2];
            const isPatch = innerContent.includes('<<<<<<< ORIGINAL');
            addOrMergeFileMod(pathVal, isPatch ? 'modified' : 'created', 'edit_file');
          }

          const patchRegex = /<(patch_file|patch_file_blocks)\s+(?:relative_)?path=["']([^"']+)["']/g;
          while ((match = patchRegex.exec(content)) !== null) {
            addOrMergeFileMod(match[2], 'modified', match[1]);
          }

          const moveRegex = /<move_file\s+source_path=["']([^"']+)["']\s+destination_path=["']([^"']+)["']/g;
          while ((match = moveRegex.exec(content)) !== null) {
            addOrMergeFileMod(match[1], 'moved', 'move_file');
          }

          // Native tool calls parsing
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              const name = tc.function?.name;
              const args = tc.function?.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {};
              if (name === 'write_file') {
                const filePath = args.filePath || args.path;
                if (filePath) {
                  addOrMergeFileMod(filePath, 'created', name);
                }
              } else if (name === 'edit_file') {
                const filePath = args.filePath || args.path;
                if (filePath) {
                  const isPatch = args.content && args.content.includes('<<<<<<< ORIGINAL');
                  addOrMergeFileMod(filePath, isPatch ? 'modified' : 'created', name);
                }
              } else if (name === 'patch_file' || name === 'patch_file_blocks') {
                const filePath = args.filePath || args.path;
                if (filePath) {
                  addOrMergeFileMod(filePath, 'modified', name);
                }
              } else if (name === 'move_file') {
                const source = args.sourcePath || args.source;
                if (source) {
                  addOrMergeFileMod(source, 'moved', name);
                }
              }
            }
          }
        }

        let filesModifiedTable = '';
        if (fileMods.size === 0) {
          filesModifiedTable = '*No files were modified in this session.*';
        } else {
          filesModifiedTable = '| File | Action | Tool Used | Edits |\n|------|--------|-----------|-------|\n';
          for (const mod of fileMods.values()) {
            filesModifiedTable += `| ${mod.file} | ${mod.action} | ${mod.toolUsed} | ${mod.edits} |\n`;
          }
        }

        const commandsRun: { command: string; outcome: string }[] = [];
        for (let i = 0; i < conversationHistory.length; i++) {
          const msg = conversationHistory[i];
          if (msg.role !== 'assistant') continue;

          // XML style parsing
          const content = msg.content || '';
          const runRegex = /<run_command\s*>([\s\S]*?)<\/run_command>/g;
          let match;
          while ((match = runRegex.exec(content)) !== null) {
            const cmd = match[1].trim();
            let outcome = '✓ passed';
            for (let k = i + 1; k < conversationHistory.length; k++) {
              const nextMsg = conversationHistory[k];
              if (nextMsg.role === 'user' && nextMsg.content.includes('<tool_output>')) {
                const outputMatch = /<tool_output\s*>([\s\S]*?)<\/tool_output>/.exec(nextMsg.content);
                const outputVal = outputMatch ? outputMatch[1].trim() : nextMsg.content.trim();
                if (outputVal.startsWith('[Command failed') || (outputVal.includes('exit code') && !outputVal.includes('exit code 0'))) {
                  outcome = '✗ failed';
                }
                break;
              }
              if (nextMsg.role === 'assistant') {
                break;
              }
            }
            commandsRun.push({ command: cmd, outcome });
          }

          // Native tool calls parsing
          if (msg.tool_calls) {
            for (const tc of msg.tool_calls) {
              if (tc.function?.name === 'run_command') {
                const args = tc.function.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {};
                const cmd = (args.command || '').trim();
                let outcome = '✓ passed';
                if (i + 1 < conversationHistory.length && conversationHistory[i + 1].role === 'tool') {
                  const outputVal = conversationHistory[i + 1].content || '';
                  if (outputVal.startsWith('[Command failed') || (outputVal.includes('exit code') && !outputVal.includes('exit code 0'))) {
                    outcome = '✗ failed';
                  }
                }
                commandsRun.push({ command: cmd, outcome });
              }
            }
          }
        }

        let commandsRunTable = '';
        if (commandsRun.length > 0) {
          commandsRunTable = '## Commands Run\n\n| Command | Outcome |\n|---------|---------|\n';
          for (const cmd of commandsRun) {
            commandsRunTable += `| ${cmd.command} | ${cmd.outcome} |\n`;
          }
          commandsRunTable += '\n';
        }

        let secretsRedacted = false;
        function redactWithNotice(c: string): string {
          const redacted = redactSecrets(c);
          if (redacted !== c) {
            secretsRedacted = true;
          }
          return redacted;
        }

        function parseCommandResult(output: string): { status: string; code: string } {
          const failMatch = /exit code (\d+)/i.exec(output);
          if (failMatch) {
            const code = parseInt(failMatch[1], 10);
            if (code === 0) return { status: '✓ exit code 0', code: '0' };
            return { status: `✗ exit code ${code}`, code: String(code) };
          }
          if (output.includes('Command failed') || output.includes('Error:')) {
            return { status: '✗ failed', code: '1' };
          }
          return { status: '✓ exit code 0', code: '0' };
        }

        function formatToolCallForMarkdown(toolName: string, attrsStr: string, innerContent: string, rawOutput: string): string {
          let out = '';
          let resultStatus = '✓ success';
          if (rawOutput.includes('Error') || rawOutput.startsWith('Error') || rawOutput.startsWith('[Command failed')) {
            resultStatus = '✗ failure';
          }

          if (toolName === 'write_file' || toolName === 'edit_file') {
            let file = '';
            const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
            if (pathAttr) {
              file = pathAttr[1];
            } else {
              const lines = innerContent.trim().split('\n');
              if (lines.length > 0) {
                file = lines[0].trim();
                innerContent = lines.slice(1).join('\n');
              }
            }

            const lineCount = innerContent.split('\n').length;
            out += `### 🔧 Tool Call: ${toolName}\n`;
            out += `**File:** ${file}\n`;
            out += `**Result:** ${resultStatus}\n\n`;

            if (lineCount <= 500) {
              const lang = getLanguageFromFilename(file);
              const redactedContent = redactWithNotice(innerContent);
              out += `\`\`\`${lang}\n${redactedContent}\n\`\`\`\n\n`;
            } else {
              out += `[File content omitted — ${lineCount} lines. See ${file}]\n\n`;
            }
          } else if (toolName === 'run_command') {
            const cmd = innerContent.trim();
            const cmdResult = parseCommandResult(rawOutput);

            const outputLines = rawOutput.split('\n');
            let truncatedOutput = outputLines.slice(0, 100).join('\n');
            if (outputLines.length > 100) {
              truncatedOutput += `\n\n[Output truncated to 100 lines — ${outputLines.length - 100} lines omitted]`;
            }
            const redactedOutput = redactWithNotice(truncatedOutput);

            out += `### 🔧 Tool Call: run_command\n`;
            out += `**Command:** \`${cmd}\`\n`;
            out += `**Result:** ${cmdResult.status}\n`;
            out += `**Output:**\n\`\`\`\n${redactedOutput}\n\`\`\`\n\n`;
          } else {
            let details = '';
            if (toolName === 'patch_file' || toolName === 'patch_file_blocks' || toolName === 'read_file') {
              const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
              if (pathAttr) details = `**File:** ${pathAttr[1]}`;
            } else if (toolName === 'move_file') {
              const srcAttr = /source_path=["']([^"']+)["']/.exec(attrsStr);
              const destAttr = /destination_path=["']([^"']+)["']/.exec(attrsStr);
              if (srcAttr && destAttr) details = `**Source:** ${srcAttr[1]}\n**Destination:** ${destAttr[1]}`;
            } else if (toolName === 'search') {
              details = `**Query:** \`${innerContent.trim()}\``;
            } else if (toolName === 'view_outline') {
              const pathAttr = /path=["']([^"']+)["']/.exec(attrsStr);
              if (pathAttr) details = `**File:** ${pathAttr[1]}`;
            } else if (toolName === 'ask_user') {
              details = `**Question:** \`${innerContent.trim()}\``;
            }

            out += `### 🔧 Tool Call: ${toolName}\n`;
            if (details) {
              out += `${details}\n`;
            }
            out += `**Result:** ${resultStatus}\n\n`;
          }
          return out;
        }

        const durationMs = Date.now() - sessionStartTime;
        function formatDuration(ms: number): string {
          const seconds = Math.floor((ms / 1000) % 60);
          const minutes = Math.floor((ms / (1000 * 60)) % 60);
          const hours = Math.floor(ms / (1000 * 60 * 60));
          const parts = [];
          if (hours > 0) parts.push(`${hours}h`);
          if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
          parts.push(`${seconds}s`);
          return parts.join(' ');
        }

        const durationStr = formatDuration(durationMs);
        const fullDateStr = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date());
        const exportTimestamp = new Date().toISOString();

        let conversationMarkdown = '';
        for (let idx = 0; idx < conversationHistory.length; idx++) {
          const msg = conversationHistory[idx];
          if (msg.role === 'system') {
            const compactMatch = /\[COMPACTED CONTEXT — conversation summarised at ([^\]]+)\]\n\n([\s\S]*)/.exec(msg.content);
            if (compactMatch) {
              const timestamp = compactMatch[1].trim();
              const summaryContent = compactMatch[2].trim();
              conversationMarkdown += `### ⚡ Context Compacted\n*Conversation history was compacted at ${timestamp}. Summary below:*\n${summaryContent}\n\n`;
            } else {
              conversationMarkdown += `### ⚙️ System\n${msg.content}\n\n`;
            }
          } else if (msg.role === 'user') {
            if (msg.content.includes('<tool_output>')) {
              continue;
            }
            conversationMarkdown += `### 👤 User\n${msg.content.trim()}\n\n`;
          } else if (msg.role === 'tool') {
            continue;
          } else if (msg.role === 'assistant') {
            let prose = msg.content || '';
            prose = prose
              .replace(/<run_command\s*>[\s\S]*?(?:<\/run_command>|$)/g, '')
              .replace(/<read_file\s*[^>]*>[\s\S]*?(?:<\/read_file>|$)/g, '')
              .replace(/<search_code\s*>[\s\S]*?(?:<\/search_code>|$)/g, '')
              .replace(/<write_file\s*[^>]*>[\s\S]*?(?:<\/write_file>|$)/g, '')
              .replace(/<patch_file\s*[^>]*>[\s\S]*?(?:<\/patch_file>|$)/g, '')
              .replace(/<patch_file_blocks\s*[^>]*>[\s\S]*?(?:<\/patch_file_blocks>|$)/g, '')
              .replace(/<edit_file\s*[^>]*>[\s\S]*?(?:<\/edit_file>|$)/g, '')
              .replace(/<search\s*[^>]*>[\s\S]*?(?:<\/search>|$)/g, '')
              .replace(/<view_outline\s*[^>]*>[\s\S]*?(?:<\/view_outline>|$)/g, '')
              .replace(/<ask_user\s*[^>]*>[\s\S]*?(?:<\/ask_user>|$)/g, '')
              .replace(/<list_dir\s*[^>]*>[\s\S]*?(?:<\/list_dir>|$)/g, '')
              .replace(/<git_status\s*[^>]*>[\s\S]*?(?:<\/git_status>|$)/g, '')
              .replace(/<diagnostics\s*[^>]*>[\s\S]*?(?:<\/diagnostics>|$)/g, '')
              .replace(/<move_file\s*[^>]*>[\s\S]*?(?:<\/move_file>|$)/g, '')
              .replace(/<(?:path_)?question\s*[^>]*\/>/g, '')
              .replace(/<(?:path_)?question\s*[^>]*>[\s\S]*?(?:<\/(?:path_)?question>|$)/g, '')
              .trim();

            if (prose) {
              conversationMarkdown += `### 🤖 Agent\n${prose}\n\n`;
            }

            // 1. XML tool calls
            const toolCallRegex = /<(run_command|read_file|write_file|patch_file|patch_file_blocks|edit_file|search|view_outline|ask_user|move_file)(\s+[^>]*?)(?:>([\s\S]*?)(?:<\/\1>|$)|\s*\/>)/g;
            let toolMatch;
            while ((toolMatch = toolCallRegex.exec(msg.content || '')) !== null) {
              const toolName = toolMatch[1];
              let toolOutputContent = '';
              
              for (let k = idx + 1; k < conversationHistory.length; k++) {
                if (conversationHistory[k].role === 'user' && conversationHistory[k].content.includes('<tool_output>')) {
                  toolOutputContent = conversationHistory[k].content;
                  break;
                }
                if (conversationHistory[k].role === 'assistant') {
                  break;
                }
              }

              let rawOutput = '';
              const outputMatch = /<tool_output\s*>([\s\S]*?)<\/tool_output>/.exec(toolOutputContent);
              if (outputMatch) {
                rawOutput = outputMatch[1].trim();
              } else {
                rawOutput = toolOutputContent.trim();
              }

              conversationMarkdown += formatToolCallForMarkdown(toolName, toolMatch[2], toolMatch[3] || '', rawOutput);
            }

            // 2. Native tool calls
            if (msg.tool_calls) {
              for (const tc of msg.tool_calls) {
                const toolName = tc.function?.name;
                const args = tc.function?.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {};
                
                let rawOutput = '';
                if (idx + 1 < conversationHistory.length && conversationHistory[idx + 1].role === 'tool') {
                  rawOutput = conversationHistory[idx + 1].content || '';
                }

                let detailsStr = '';
                let innerContent = '';
                if (toolName === 'write_file' || toolName === 'edit_file') {
                  detailsStr = ` path="${args.filePath || args.path}"`;
                  innerContent = args.content || '';
                } else if (toolName === 'read_file') {
                  detailsStr = ` path="${args.path || args.filePath}"`;
                } else if (toolName === 'run_command') {
                  innerContent = args.command || '';
                } else if (toolName === 'search') {
                  detailsStr = ` scope="${args.scope || 'code'}"${args.pathVal ? ` path="${args.pathVal}"` : ''}`;
                  innerContent = args.query || '';
                } else if (toolName === 'view_outline') {
                  detailsStr = ` path="${args.path}"`;
                } else if (toolName === 'ask_user') {
                  detailsStr = args.options ? ` options="${args.options}"` : '';
                  innerContent = args.question || '';
                } else if (toolName === 'move_file') {
                  detailsStr = ` source_path="${args.sourcePath}" destination_path="${args.destinationPath}"`;
                }

                conversationMarkdown += formatToolCallForMarkdown(toolName, detailsStr, innerContent, rawOutput);
              }
            }
          }
        }

        let metadataNotice = '';
        if (secretsRedacted) {
          metadataNotice = `\n> ⚠ Note: Secret patterns were automatically redacted from this export.\n`;
        }

        const exportMarkdown = `# Ruthen Session — ${fullDateStr}\n\n` +
          `**Duration:** ${durationStr}\n` +
          `**Messages:** ${conversationHistory.length}\n` +
          `**Workspace:** ${workspaceRoot}\n` +
          `**Model:** ${activeModel}\n` +
          `**Exported:** ${exportTimestamp}\n` +
          metadataNotice +
          `\n---\n\n` +
          `## Files Modified This Session\n\n` +
          filesModifiedTable +
          `\n\n` +
          commandsRunTable +
          `---\n\n` +
          `## Full Conversation\n\n` +
          conversationMarkdown;

        try {
          fs.mkdirSync(path.dirname(finalPath), { recursive: true });
          fs.writeFileSync(finalPath, exportMarkdown, 'utf8');
          const stats = fs.statSync(finalPath);
          const sizeKb = (stats.size / 1024).toFixed(0);

          let displayPath = finalPath;
          if (displayPath.startsWith(homeDir)) {
            displayPath = '~' + displayPath.slice(homeDir.length);
          }

          ui.printSystemMessage('info', `Session exported to ${displayPath} (${sizeKb} KB)`);
        } catch (e: any) {
          ui.printSystemMessage('error', `Failed to write export file: ${e.message}`);
        }

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
          useNativeTools = false;
          ui.updateStatus(activeModel, '0', gitBranch);
          ui.printSystemMessage('info', `Switched to active model: ${activeModel} (Native tools: ${useNativeTools ? 'yes' : 'no'})`);
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
        const runSearch = (queryStr: string) => {
          const results = indexer.search(queryStr);
          let out = `\nFound ${results.length} matches:\n`;
          results.slice(0, 5).forEach(r => {
            out += `  - ${r.relpath} (line ${r.start_line}-${r.end_line})\n`;
          });
          ui.addTextOutput(out);
        };

        if (!arg) {
          const query = await ui.interactiveInput('Enter search query:');
          const searchArg = query.trim();
          if (!searchArg) {
            ui.printSystemMessage('error', 'Search cancelled: empty query.');
          } else {
            runSearch(searchArg);
          }
        } else {
          runSearch(arg);
        }
        return;
      }

      if (command === '/audit') {
        const store = new AuditLogStore(indexer.db);
        const limitStr = arg ? arg.trim() : '15';
        const limit = parseInt(limitStr, 10) || 15;
        const logs = store.getRecentLogs(limit);
        if (logs.length === 0) {
          ui.printSystemMessage('info', 'No audit logs recorded yet.');
          return;
        }
        let out = `\nRecent Activity Audit Logs:\n`;
        logs.forEach(l => {
          const time = new Date(l.timestamp).toLocaleTimeString();
          const statusText = l.status === 'completed' || l.status === 'approved' 
            ? chalk.green(l.status) 
            : l.status === 'failed' ? chalk.red(l.status) : chalk.yellow(l.status);
          out += `  [${time}] ${chalk.cyan(l.service)} · ${l.operation} -> ${l.target} (${statusText})\n`;
        });
        ui.addTextOutput(out);
        return;
      }

      if (command === '/connect') {
        let service = '';
        let token = '';

        if (arg) {
          const parts = arg.trim().split(/\s+/);
          if (parts.length === 2) {
            [service, token] = parts;
          } else {
            ui.printSystemMessage('error', 'Usage: /connect <service> <token> or just /connect to open the interactive menu.');
            return;
          }
        } else {
          const options = [
            'Tavily (Web Search)',
            'Exa (Web Search)',
            'Jina (Web Search)',
            'Serper (Web Search)',
            'GitHub API Integration',
            'Slack Webhook Integration',
            'Notion Database Integration',
            'Disconnect Service'
          ];
          const choiceIdx = await ui.interactiveSelect('Select Service to Connect:', options);
          if (choiceIdx === -1) return;

          if (choiceIdx === 7) {
            const disconnectOptions = [
              'tavily',
              'exa',
              'jina',
              'serper',
              'github',
              'slack',
              'notion'
            ];
            const selectDisconnectIdx = await ui.interactiveSelect('Select Service to Disconnect:', disconnectOptions);
            if (selectDisconnectIdx === -1) return;
            const targetService = disconnectOptions[selectDisconnectIdx];
            try {
              const { disconnectService } = await import('../pro/connect/index.js');
              disconnectService(targetService);
              ui.printSystemMessage('info', `Disconnected credentials for service: ${targetService}`);
            } catch (e: any) {
              ui.printSystemMessage('error', `Failed to disconnect service: ${e.message}`);
            }
            return;
          }

          const serviceNames = ['tavily', 'exa', 'jina', 'serper', 'github', 'slack', 'notion'];
          service = serviceNames[choiceIdx];

          const inputPrompt = `Enter API Token/Key for ${options[choiceIdx]}:`;
          token = await ui.interactiveInput(inputPrompt);
          if (!token || token.trim().length === 0) {
            ui.printSystemMessage('error', 'API Token/Key cannot be empty.');
            return;
          }
          token = token.trim();
        }

        ui.showToolProgress(`Connecting service ${service}...`);
        try {
          const { connectService, isSecretToolAvailable } = await import('../pro/connect/index.js');
          
          if (process.platform !== 'darwin' && !isSecretToolAvailable()) {
            const { vaultExists, unlockWithPassword, initializeVault } = await import('../pro/connect/vault.js');
            if (vaultExists()) {
              let unlocked = false;
              while (!unlocked) {
                const password = await ui.interactiveInput('Enter Vault Master Password to unlock credentials store:');
                if (!password) {
                  ui.printSystemMessage('error', 'Password required to unlock credentials vault.');
                  ui.hideToolProgress();
                  return;
                }
                unlocked = unlockWithPassword(password);
                if (!unlocked) {
                  ui.printSystemMessage('error', 'Incorrect password. Try again.');
                }
              }
            } else {
              const password = await ui.interactiveInput('Create a new Vault Master Password to encrypt API credentials:');
              if (!password) {
                ui.printSystemMessage('error', 'Password required to initialize credentials vault.');
                ui.hideToolProgress();
                return;
              }
              const confirmPassword = await ui.interactiveInput('Confirm Vault Master Password:');
              if (password !== confirmPassword) {
                ui.printSystemMessage('error', 'Passwords do not match. Vault initialization aborted.');
                ui.hideToolProgress();
                return;
              }
              const recoveryKey = initializeVault(password);
              ui.printSystemMessage('info', `Vault initialized successfully!\nYour Recovery Key (keep this safe!):\n--> ${recoveryKey}`);
            }
          }
          
          await connectService(service, token);
          ui.hideToolProgress();
          ui.printSystemMessage('info', `Successfully connected service: ${service}`);
        } catch (e: any) {
          ui.hideToolProgress();
          ui.printSystemMessage('error', `Failed to connect service: ${e.message}`);
        }
        return;
      }

      if (command === '/reset-password') {
        if (process.platform === 'darwin') {
          ui.printSystemMessage('info', 'Password vault not used on macOS (using native Keychain).');
          return;
        }
        const { isSecretToolAvailable } = await import('../pro/connect/index.js');
        if (isSecretToolAvailable()) {
          ui.printSystemMessage('info', 'Password vault not used (using Linux Secret Service Keyring).');
          return;
        }
        
        const { vaultExists, unlockWithRecoveryKey, resetVaultPassword } = await import('../pro/connect/vault.js');
        if (!vaultExists()) {
          ui.printSystemMessage('error', 'Vault does not exist. Use /connect to initialize it first.');
          return;
        }

        const recoveryKey = await ui.interactiveInput('Enter Vault Master Recovery Key:');
        if (!recoveryKey) {
          ui.printSystemMessage('error', 'Recovery key required.');
          return;
        }

        const unlocked = unlockWithRecoveryKey(recoveryKey.trim());
        if (!unlocked) {
          ui.printSystemMessage('error', 'Invalid Recovery Key.');
          return;
        }

        const newPassword = await ui.interactiveInput('Enter new Master Password:');
        if (!newPassword) {
          ui.printSystemMessage('error', 'New password required.');
          return;
        }
        const confirmPassword = await ui.interactiveInput('Confirm new Master Password:');
        if (newPassword !== confirmPassword) {
          ui.printSystemMessage('error', 'Passwords do not match.');
          return;
        }

        const success = resetVaultPassword(recoveryKey.trim(), newPassword);
        if (success) {
          ui.printSystemMessage('info', 'Vault master password reset successfully.');
        } else {
          ui.printSystemMessage('error', 'Failed to reset vault password.');
        }
        return;
      }

      ui.printSystemMessage('error', `Unknown command: ${command}`);
      return;
    }

    conversationHistory.push({ role: 'user', content: trimmed });
    recentToolCallsFingerprints.length = 0; // Clear loop detection history on new user turn

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
      
      const memoryContext = memoryStore.generateMemoryContextBlock();

      const systemMessage = {
        role: 'system',
        content: `${SYSTEM_INSTRUCTIONS}\n\n<conversational_tone>\n${toneBlock}\n</conversational_tone>\n\n[Active Repository Map]\n${currentRepoMap}\n\n${currentChanges}${memoryContext}`
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
          activeAbortController.signal,
          useNativeTools ? OLLAMA_TOOLS : undefined
        );
        activeAbortController = null;

        ui.endStreaming();
        const modelResponse = chatResult.content;
        lastInputTokens = chatResult.usage.input_tokens;

        if (chatResult.usage.input_tokens / contextLimit >= compactThreshold) {
          pendingCompaction = true;
        }

        let toolResult: { toolRun: boolean; nextPrompt: string; consoleOutput: string } = {
          toolRun: false,
          nextPrompt: '',
          consoleOutput: ''
        };

        if (useNativeTools && chatResult.tool_calls && chatResult.tool_calls.length > 0) {
          ui.printModelResponse(modelResponse || 'Executing tools...', thinkingEnabled);
          
          const tc = chatResult.tool_calls[0];
          const fingerprint = getToolCallFingerprint(tc);
          
          if (recentToolCallsFingerprints.includes(fingerprint)) {
            ui.printToolResult('failure', `Tool: ${tc.function.name} (blocked: loop detected)`);
            ui.printSystemMessage('guard', `Loop detected. Returning control to user.`);
            toolResult = {
              toolRun: false,
              nextPrompt: '',
              consoleOutput: `\n[Loop detected: ${tc.function.name}]`
            };
          } else {
            recentToolCallsFingerprints.push(fingerprint);
            if (recentToolCallsFingerprints.length > MAX_FINGERPRINTS) {
              recentToolCallsFingerprints.shift();
            }

            const xmlEquivalent = formatToolCallToXml(tc);
            if (xmlEquivalent) {
              toolResult = await handleToolCalls(xmlEquivalent, sandbox, indexer, ui, state);
            }
          }
        } else {
          ui.printModelResponse(modelResponse, thinkingEnabled);

          const xmlFingerprint = getXmlToolCallFingerprint(modelResponse);
          if (xmlFingerprint && recentToolCallsFingerprints.includes(xmlFingerprint)) {
            ui.printToolResult('failure', `Tool call blocked: loop detected`);
            ui.printSystemMessage('guard', `Loop detected. Returning control to user.`);
            toolResult = {
              toolRun: false,
              nextPrompt: '',
              consoleOutput: `\n[Loop detected]`
            };
          } else {
            if (xmlFingerprint) {
              recentToolCallsFingerprints.push(xmlFingerprint);
              if (recentToolCallsFingerprints.length > MAX_FINGERPRINTS) {
                recentToolCallsFingerprints.shift();
              }
            }
            toolResult = await handleToolCalls(modelResponse, sandbox, indexer, ui, state);
          }
        }

        // Autopilot test-healing loop
        const hasEditedFiles = modelResponse.includes('<patch_file') || 
                            modelResponse.includes('<write_file') || 
                            modelResponse.includes('<edit_file') ||
                            (chatResult.tool_calls && chatResult.tool_calls.some((tc: any) => tc.function.name === 'edit_file'));
        
        if (autopilotEnabled && toolResult.toolRun && hasEditedFiles) {
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
          if (useNativeTools && chatResult.tool_calls && chatResult.tool_calls.length > 0) {
            conversationHistory.push({
              role: 'assistant',
              content: modelResponse,
              tool_calls: chatResult.tool_calls
            });
            
            const rawOutput = toolResult.nextPrompt
              .replace('<tool_output>\n', '')
              .replace('\n</tool_output>', '');
              
            conversationHistory.push({
              role: 'tool',
              content: rawOutput
            });
          } else {
            conversationHistory.push({ role: 'assistant', content: modelResponse });
            conversationHistory.push({ role: 'user', content: toolResult.nextPrompt });
          }
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
        if (err.message === 'REPETITION_LOOP') {
          ui.printSystemMessage('error', 'Generation stopped: model entered an infinite repetition loop.');
        } else {
          ui.printSystemMessage('error', `Generation failed: ${err.message}`);
        }
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
