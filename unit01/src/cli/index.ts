import '../core/warnings.js';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { DirectiveIndexer } from '../core/indexer/index.js';
import { DirectiveSandbox } from '../core/security/sandbox.js';
import { ollama } from '../core/llm/client.js';
import { buildRepoMap } from '../core/indexer/repomap.js';
import { AllowedPath } from '../core/security/types.js';
import { SessionStore, SessionData, runStalenessCheck } from '../core/session/index.js';
import { handleToolCalls, CliState } from './commands.js';
import {
  themePrimary,
  themeBorder,
  themeAccent,
  themeGold,
  themeOrange,
  themeGray,
  themeRed,
  isGui,
  guiEmit,
  countVisualLines
} from './views/theme.js';
import {
  printWelcomeBanner,
  printSystemMessage,
  interactiveSelect,
  ThinkingSpinner
} from './views/components.js';
import {
  renderSideBySideDiff,
  renderNewFileBlock
} from './views/diff.js';
import {
  processChunk,
  hasRepetitionLoop,
  renderMarkdown
} from './views/chat.js';
import { interactivePrompt } from './prompt.js';
import { getRelativeTime } from './views/components.js';
import { getLanguageFromFilename } from './parser.js';

// System prompt instructing local model on tool-calling behavior
const SYSTEM_INSTRUCTIONS = `You are Unit01, a directive AI coding assistant.
You can execute tools by wrapping commands in specific XML tags. Here are concrete examples of how to invoke them:

- To run a shell command: <run_command>npm test</run_command>
- To read a file: <read_file>src/db.ts</read_file>
- To write or overwrite a new file: <write_file path="src/main.ts">console.log("hello");</write_file>
- To search the codebase: <search_code>DatabaseSync</search_code>
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
- To list directory contents directly: <list_dir path="src" recursive="false" />
- To view structured git status: <git_status />
- To run project compilation/linter diagnostics: <diagnostics /> or <diagnostics command="npm run lint" />
- To rename or move a file: <move_file source_path="old.py" destination_path="new.py" />
- To ask the developer a question or request path permission (substitute the target path dynamically):
  <question options="Allow read-write, Allow read-only, Deny">I need access to /path/to/directory to complete this task. Grant access?</question>

Rules:
1. Execute only ONE tool at a time.
2. Once you write a tool call tag, stop outputting text immediately. Wait for the tool output to be returned to you in a <tool_output> block. Do NOT write any conversational text, preambles, or introductory explanations (such as "To read the file...", "You can run this command...", etc.) before writing the XML tool tag. Simply output the XML tool tag directly.
3. Do not write placeholders like "relative_path". Write the actual path directly.
4. Keep your explanations concise, professional, and code-focused.
5. Before executing any file, ensure it has been written using write_file first. Always use absolute paths.
6. Tool Selection Priority:
   - Use patch_file_blocks as the default tool to edit existing files.
   - Use patch_file for simple, single exact replacements.
   - Use write_file only when creating new files. Never write_file on an existing file.
   - Use move_file to rename or move files. Never use cp + rm or mv in run_command.
   - You MUST use the <question> tool to request path access if you need to access files outside the workspace. Do NOT request path access, ask questions, or clarify requirements via plain conversational text, as the user has no way to grant permissions or respond unless you invoke the <question> tool tag.
7. Complex Task / New Project Workflow:
   - When asked to create a new application, website, game, or implement a large feature, DO NOT write files immediately.
   - First, present a clear architectural plan detailing the files you plan to create/modify and libraries you need. Wait for user approval or feedback.
   - After approval, implement the code incrementally—write or edit only ONE file per turn, starting with the base configuration and core logic.
   - Keep code modular and clean. Separate concerns (e.g., separate UI rendering from core logic) to prevent massive single-file dumps.
8. To access files or directories outside the workspace (such as the home directory), first attempt to access them using filesystem tools (e.g. <list_dir path="${os.homedir()}" />) or commands. If the tool fails with a PATH_NOT_ALLOWED error, copy the exact path from the error response and immediately request access using the question tool (e.g., <question options="Allow read-write, Allow read-only, Deny">I need access to ${os.homedir()} to complete this task. Grant access?</question>). You MUST use the <question> tool tag; do NOT attempt to request permission or ask for access using plain conversational text.
9. When using the <question> tool to request path permission, always substitute the target path dynamically (do not literally copy "/path/to/directory" from the example; use the actual absolute path you need to access, e.g. "${os.homedir()}").
`;

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

interface RuthenConfig {
  allowed_paths?: AllowedPath[];
  compact_threshold?: number;
  test_command?: string;
}

function loadConfig(workspaceRoot: string): RuthenConfig {
  const configPath = path.join(workspaceRoot, 'ruthen.json');
  if (fs.existsSync(configPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return data || {};
    } catch (e: any) {
      printSystemMessage('warn', `Failed to parse ruthen.json config: ${e.message}`);
    }
  }
  return {};
}

async function startCli() {
  // Determine root directory (upwards relative to current module)
  const currentFilePath = new URL(import.meta.url).pathname;
  const currentDir = path.dirname(currentFilePath);
  let workspaceRoot = path.resolve(currentDir, '..', '..');

  // Parse command line arguments
  const args = process.argv.slice(2);
  let activeModelArg: string | null = null;
  let nonInteractivePrompt: string | null = null;
  const cliAllowedPaths: AllowedPath[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && i + 1 < args.length) {
      workspaceRoot = path.resolve(args[i + 1]);
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
    }
  }

  // 1. Discover local Ollama models
  const models = await ollama.listModels();
  if (models.length === 0) {
    printSystemMessage('error', 'No local Ollama models detected. Ensure Ollama is running and you have downloaded a model, for example: ollama run qwen2.5-coder.');
    process.exit(1);
  }

  let activeModel = models[0].name;
  if (activeModelArg) {
    const matchIndex = models.findIndex(m => m.name === activeModelArg);
    if (matchIndex !== -1) {
      activeModel = models[matchIndex].name;
    } else {
      printSystemMessage('warn', `Specified model "${activeModelArg}" not found in local library. Using default: ${activeModel}`);
    }
  }

  let contextLimit = await ollama.getContextLimit(activeModel);
  let thinkingEnabled = true;

  // Load config and merge allowed paths
  const config = loadConfig(workspaceRoot);
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

  // Check home directory warnings
  if (workspaceRoot === os.homedir()) {
    printSystemMessage('warn', 'Workspace root set to user home directory. Sandbox isolation disabled for structural directories.');
  }

  // CLI state
  const state: CliState = {
    lastWrittenFile: null,
    activeAllowedPaths: resolvedAllowedPaths,
    isNonInteractive: !!nonInteractivePrompt
  };

  let compactThreshold = 0.8;
  if (config.compact_threshold !== undefined) {
    if (typeof config.compact_threshold !== 'number' || config.compact_threshold < 0.5 || config.compact_threshold > 0.95) {
      printSystemMessage('error', `"compact_threshold" must be a number between 0.5 and 0.95. Received: ${config.compact_threshold}`);
      process.exit(1);
    }
    compactThreshold = config.compact_threshold;
  }

  // Session variables
  let sessionId: string = crypto.randomUUID();
  let autopilotEnabled = false;
  let sessionStartTime = Date.now();
  let lastInputTokens = 0;
  let pendingCompaction = false;
  let currentOperation: string | null = null;
  const conversationHistory: { role: string; content: string }[] = [];

  // Initialize DB & watcher
  const indexer = new DirectiveIndexer(workspaceRoot);
  await indexer.initialize({ silent: true });

  // Connect Tier Feature: Local Semantic Search Indexing
  try {
    const { indexMissingEmbeddings } = await import('../pro/search/index.js');
    await indexMissingEmbeddings(indexer['db']);
  } catch (e) {}

  const filesCount = indexer['db'].getAllFiles().length;

  // Setup sandbox with warning callback
  const sandbox = new DirectiveSandbox(
    workspaceRoot,
    state.activeAllowedPaths,
    (type, msg) => printSystemMessage(type, msg)
  );
  await sandbox.initialize([], { silent: true });

  const sessionStore = new SessionStore(workspaceRoot);
  const gitBranch = getGitBranch(workspaceRoot);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  // Print Welcome Banner
  printWelcomeBanner(workspaceRoot, activeModel, contextLimit, filesCount);

  // Helper functions
  const runCompaction = async (isAuto: boolean): Promise<boolean> => {
    if (conversationHistory.length < 3) {
      if (!isAuto) {
        console.log(chalk.yellow('Nothing to compact yet — session has fewer than 3 messages.'));
      }
      return false;
    }

    const activeRepoMap = indexer.getRepoMap();
    const activeChanges = indexer.getRecentChanges();
    const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
    const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
    const pct = Math.round((totalTokens / contextLimit) * 100);

    if (!isAuto) {
      console.log(chalk.gray(`Compacting context (currently ${totalTokens.toLocaleString()} tokens, ${pct}% of limit)...`));
    }

    // Determine history to summarize
    let messagesToSummarize = [...conversationHistory];
    const currentPct = totalTokens / contextLimit;
    if (currentPct > 0.60) {
      const countToKeep = Math.max(1, Math.floor(conversationHistory.length * 0.60));
      messagesToSummarize = conversationHistory.slice(-countToKeep);
    }

    const summaryPrompt = `Summarise this conversation into a concise but complete technical brief. Include:
- The original goal and current task state
- Every file that was read, created, or modified (exact paths)
- Every command that was run and its outcome
- Every decision made and why
- Any errors encountered and how they were resolved
- Exactly what has been done and what still remains

Be specific. Use exact file names, function names, and line numbers where relevant.`;

    const summarisationPayload = [
      ...messagesToSummarize,
      {
        role: 'user',
        content: summaryPrompt
      }
    ];

    const abortController = new AbortController();
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    const hasRawMode = typeof stdin.setRawMode === 'function';

    const onKeypress = (str: any, key: any) => {
      if (key) {
        if (key.name === 'escape') {
          abortController.abort();
        } else if (key.ctrl && key.name === 'c') {
          if (hasRawMode) {
            try {
              stdin.removeListener('keypress', onKeypress);
              stdin.setRawMode(wasRaw);
            } catch (_) {}
          }
          process.exit(130);
        }
      }
    };

    if (hasRawMode) {
      try {
        stdin.setRawMode(true);
        stdin.resume();
        readline.emitKeypressEvents(stdin);
        stdin.on('keypress', onKeypress);
      } catch (_) {}
    }

    try {
      try {
        const chatResult = await ollama.chatStream(
          activeModel,
          summarisationPayload,
          contextLimit,
          () => {}, // silent streaming
          abortController.signal
        );

        const summaryContent = chatResult.content.trim();
        if (!summaryContent) {
          throw new Error('Model returned an empty summary');
        }

        // Replace history
        conversationHistory.length = 0;
        conversationHistory.push({
          role: 'system',
          content: `[COMPACTED CONTEXT — conversation summarised at ${new Date().toISOString()}]\n\n${summaryContent}`
        });

        const newHistoryLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const newTotal = systemPromptLength + newHistoryLength;
        const saved = totalTokens - newTotal;
        lastInputTokens = newTotal;

        const newPct = Math.round((newTotal / contextLimit) * 100);
        const formatK = (tokens: number) => {
          if (tokens >= 1000) {
            return `${Math.round(tokens / 1000)}k`;
          }
          return tokens.toString();
        };

        printSystemMessage('info', `context compacted  ·  ${pct}% → ${newPct}%  ·  saved ${formatK(saved)} tokens`);
        return true;
      } finally {
        if (hasRawMode) {
          try {
            stdin.removeListener('keypress', onKeypress);
            stdin.setRawMode(wasRaw);
          } catch (_) {}
        }
      }
    } catch (err: any) {
      const isAbort = err.name === 'AbortError' || 
                      err.message?.includes('aborted') || 
                      err.message?.includes('Abort');
      if (isAbort) {
        printSystemMessage('warn', 'Compaction aborted by user. Context not compacted.');
      } else {
        printSystemMessage('warn', `Compaction failed during LLM summarization. Context not compacted. Error: ${err.message}`);
      }
      return false;
    } finally {
      pendingCompaction = false;
    }
  };

  const resumeSession = async (sessionData: SessionData) => {
    // Clear and replace history
    conversationHistory.length = 0;
    conversationHistory.push(...sessionData.conversationHistory);

    // Model checks
    const oldModel = sessionData.activeModel;
    const modelExists = models.some(m => m.name === oldModel);
    if (modelExists) {
      activeModel = oldModel;
      contextLimit = await ollama.getContextLimit(activeModel);
    } else {
      printSystemMessage('warn', `Session was using "${oldModel}" which is no longer available locally. Continuing with "${activeModel}".`);
    }

    // Reset lastInputTokens
    lastInputTokens = 0;

    // Staleness check
    runStalenessCheck(sessionData.conversationHistory, workspaceRoot, (msg) => printSystemMessage('warn', msg));

    // Update session metadata
    sessionId = sessionData.id;
    sessionStartTime = sessionData.startedAt;

    // Print success
    const relTime = getRelativeTime(sessionData.lastUpdatedAt);
    const msgCount = sessionData.messageCount;
    const cleanMsg = sessionData.firstMessage.replace(/\r?\n/g, ' ').trim();
    const truncated = cleanMsg.length > 50 ? cleanMsg.substring(0, 50) + '...' : cleanMsg;
    console.log(chalk.cyan(`✓ Resumed session from ${relTime} (${msgCount} messages, "${truncated}")`));
    
    askQuestion();
  };

  const askQuestion = async () => {
    const input = await interactivePrompt();
    const trimmed = input.trim();
    if (!trimmed) {
      askQuestion();
      return;
    }

    console.log('  ' + themePrimary('❯') + ' ' + chalk.bgHex('#3A4454').hex('#E2E8F0')(' ' + input + ' '));

    currentOperation = trimmed.startsWith('/') ? trimmed.split(/\s+/)[0] : null;

    if (trimmed.startsWith('/')) {
      const parts = trimmed.split(/\s+/);
      let command = parts[0].toLowerCase();
      let arg = parts.slice(1).join(' ');

      if (command === '/exit' || command === '/quit') {
        console.log(chalk.yellow('Shutting down file watchers and sandbox proxies...'));
        indexer.close();
        sandbox.stop();
        rl.close();
        process.exit(0);
      }

      if (command === '/clear') {
        conversationHistory.length = 0;
        lastInputTokens = 0;
        console.log(chalk.gray('Conversation history cleared.'));
        try {
          sessionStore.save(sessionId, { startedAt: sessionStartTime, activeModel, conversationHistory });
        } catch (e) {}
        askQuestion();
        return;
      }

      if (command === '/sessions') {
        const sessions = sessionStore.list(workspaceRoot).filter(s => s.id !== sessionId);
        if (sessions.length === 0) {
          console.log('No previous sessions found for this workspace.');
          askQuestion();
          return;
        }

        const recentSessions = sessions.slice(0, 10);
        const sessionOptions = recentSessions.map(s => {
          const relTime = getRelativeTime(s.lastUpdatedAt);
          const cleanMsg = s.firstMessage.replace(/\r?\n/g, ' ').trim();
          const truncated = cleanMsg.length > 50 ? cleanMsg.substring(0, 50) + '...' : cleanMsg;
          return `${relTime} · ${s.messageCount} messages · "${truncated}"`;
        });

        const chosenIdx = await interactiveSelect('Browse Sessions:', sessionOptions);
        if (chosenIdx === -1) {
          askQuestion();
          return;
        }

        const selectedSession = recentSessions[chosenIdx];
        const actionIdx = await interactiveSelect('Session Action:', ['Resume', 'Delete', 'Cancel']);
        if (actionIdx === -1 || actionIdx === 2) {
          askQuestion();
          return;
        }

        if (actionIdx === 0) {
          await resumeSession(selectedSession);
        } else if (actionIdx === 1) {
          rl.question('Delete this session? This cannot be undone. [y/N]: ', (answer) => {
            const normalized = answer.trim().toLowerCase();
            if (normalized === 'y' || normalized === 'yes') {
              sessionStore.delete(selectedSession.id);
              console.log('✓ Session deleted.');
            }
            askQuestion();
          });
        }
        return;
      }

      if (command === '/resume') {
        const sessions = sessionStore.list(workspaceRoot).filter(s => s.id !== sessionId);
        if (sessions.length === 0) {
          console.log('No previous sessions found for this workspace.');
          askQuestion();
          return;
        }

        const nStr = arg.trim();
        if (nStr) {
          const n = parseInt(nStr, 10);
          if (isNaN(n) || n < 1 || n > sessions.length) {
            console.log(chalk.red(`Invalid session number. Available sessions: 1 to ${sessions.length}.`));
            askQuestion();
            return;
          }
          const targetSession = sessions[n - 1];
          await resumeSession(targetSession);
          return;
        } else {
          const recentSessions = sessions.slice(0, 10);
          const sessionOptions = recentSessions.map(s => {
            const relTime = getRelativeTime(s.lastUpdatedAt);
            const cleanMsg = s.firstMessage.replace(/\r?\n/g, ' ').trim();
            const truncated = cleanMsg.length > 50 ? cleanMsg.substring(0, 50) + '...' : cleanMsg;
            return `${relTime} · ${s.messageCount} messages · "${truncated}"`;
          });

          const chosenIdx = await interactiveSelect('Resume Session:', sessionOptions);
          if (chosenIdx === -1) {
            askQuestion();
            return;
          }
          const targetSession = recentSessions[chosenIdx];
          await resumeSession(targetSession);
          return;
        }
      }

      if (command === '/connect') {
        const runConnectMenu = async () => {
          if (process.platform !== 'darwin') {
            const { vaultExists } = await import('../pro/connect/vault.js');
            const exists = vaultExists();
            let locked = false;
            if (exists) {
              try {
                const { getCredential } = await import('../pro/connect/vault.js');
                getCredential('dummy');
              } catch (e: any) {
                if (e.message && e.message.includes('locked')) {
                  locked = true;
                }
              }
            }

            if (!exists) {
              console.log(chalk.yellow('ॐ credentials vault does not exist. Initializing...'));
              await new Promise<void>((resolve) => {
                rl.question('Enter Master Password to secure credentials vault: ', async (pass) => {
                  const password = pass.trim();
                  if (!password) {
                    console.log(chalk.red('Failed: password cannot be empty.'));
                  } else {
                    const { initializeVault } = await import('../pro/connect/vault.js');
                    const recoveryKey = initializeVault(password);
                    console.log('\n  ' + chalk.green('✓ Credentials Vault Initialized!'));
                    console.log(`  ⚠️  ${chalk.bold('SAVE THIS MASTER RECOVERY KEY IN A SAFE PLACE:')}`);
                    console.log(`  ${chalk.cyan.bold(recoveryKey)}\n`);
                  }
                  resolve();
                });
              });
              askQuestion();
              return;
            } else if (locked) {
              await new Promise<void>((resolve) => {
                rl.question('Credentials Vault is locked. Enter Master Password to unlock (or type /recovery): ', async (answer) => {
                  const input = answer.trim();
                  if (input === '/recovery') {
                    rl.question('Enter Master Recovery Key: ', async (recKey) => {
                      const recoveryKey = recKey.trim();
                      const { unlockWithRecoveryKey } = await import('../pro/connect/vault.js');
                      if (unlockWithRecoveryKey(recoveryKey)) {
                        console.log(chalk.green('✓ Vault successfully unlocked using Recovery Key!'));
                      } else {
                        console.log(chalk.red('✗ Invalid Recovery Key.'));
                      }
                      resolve();
                    });
                  } else {
                    const { unlockWithPassword } = await import('../pro/connect/vault.js');
                    if (unlockWithPassword(input)) {
                      console.log(chalk.green('✓ Vault successfully unlocked!'));
                    } else {
                      console.log(chalk.red('✗ Invalid Master Password.'));
                    }
                    resolve();
                  }
                });
              });
              askQuestion();
              return;
            }
          }

          const services = ['GitHub', 'GitLab', 'Slack', 'Notion', 'Discord', 'Telegram', 'Web Search'];
          const serviceKeys = ['github', 'gitlab', 'slack', 'notion', 'discord', 'telegram', 'web-search'];
          
          const { isServiceConnected } = await import('../pro/connect/index.js');
          
          const options = services.map((svc, i) => {
            const connected = isServiceConnected(serviceKeys[i]);
            const status = connected ? chalk.green('✓ Connected') : themeGray('Not Connected');
            return `${svc.padEnd(12)} [${status}]`;
          });

          console.log(`\n  ॐ  ${themePrimary.bold('unit01 connect')}  ${themeGray('·  Select Service to Authenticate')}`);
          console.log('  ' + '─'.repeat(50));
          const chosenIdx = await interactiveSelect('Choose Service:', options);
          if (chosenIdx === -1) {
            askQuestion();
            return;
          }

          const service = serviceKeys[chosenIdx];
          const serviceName = services[chosenIdx];
          const connected = isServiceConnected(service);

          if (connected) {
            const actionIdx = await interactiveSelect(`Service ${serviceName} is already connected. Action:`, [
              'Update Credentials',
              'Disconnect Service',
              'Cancel'
            ]);
            
            if (actionIdx === 1) {
              const { disconnectService } = await import('../pro/connect/index.js');
              disconnectService(service);
              if (service === 'web-search') {
                disconnectService('google-api-key');
                disconnectService('google-cx');
              } else if (service === 'github') {
                disconnectService('github-token');
              } else if (service === 'slack') {
                disconnectService('slack-token');
              } else if (service === 'discord') {
                disconnectService('discord-token');
              } else if (service === 'telegram') {
                disconnectService('telegram-token');
              } else if (service === 'notion') {
                disconnectService('notion-token');
              }

              try {
                const { AuditLogStore } = await import('../pro/audit/index.js');
                const auditStore = new AuditLogStore(indexer['db']);
                auditStore.logAction({
                  service: 'connect',
                  operation: 'disconnect',
                  target: service,
                  payload_summary: `Disconnected ${serviceName}`,
                  payload_hash: crypto.createHash('sha256').update(service).digest('hex'),
                  status: 'completed'
                });
              } catch (_) {}

              console.log(chalk.cyan(`✓ Disconnected service ${serviceName}.`));
              askQuestion();
              return;
            } else if (actionIdx === -1 || actionIdx === 2) {
              askQuestion();
              return;
            }
          }

          if (service === 'web-search') {
            await new Promise<void>((resolve) => {
              rl.question('🔑 Enter Google Custom Search API Key (or press Enter to go back): ', (keyInput) => {
                const key = keyInput.trim();
                if (!key || key === '/back') {
                  console.log(chalk.gray('Cancelled.'));
                  runConnectMenu().then(resolve);
                  return;
                }
                rl.question('🔑 Enter Google Search Engine ID (CX) (or press Enter to go back): ', async (cxInput) => {
                  const cx = cxInput.trim();
                  if (!cx || cx === '/back') {
                    console.log(chalk.gray('Cancelled.'));
                    runConnectMenu().then(resolve);
                    return;
                  }

                  process.stdout.write(`\n  ${themeOrange('⠋')} Validating Web Search credentials...`);
                  const { connectService } = await import('../pro/connect/index.js');
                  try {
                    await connectService('google-api-key', key);
                    await connectService('google-cx', cx);

                    try {
                      const { AuditLogStore } = await import('../pro/audit/index.js');
                      const auditStore = new AuditLogStore(indexer['db']);
                      auditStore.logAction({
                        service: 'connect',
                        operation: 'connect',
                        target: 'web-search',
                        payload_summary: `Connected Google Web Search`,
                        payload_hash: crypto.createHash('sha256').update(key + cx).digest('hex'),
                        status: 'completed'
                      });
                    } catch (_) {}

                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                    console.log(chalk.green(`✓ Successfully connected Google Web Search!`));
                  } catch (e: any) {
                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                    console.log(chalk.red(`✗ Failed: ${e.message}`));
                  }
                  resolve();
                });
              });
            });
          } else {
            const keyNameMap: Record<string, string> = {
              github: 'github-token',
              slack: 'slack-token',
              discord: 'discord-token',
              telegram: 'telegram-token',
              notion: 'notion-token',
              gitlab: 'gitlab-token'
            };
            const storageKey = keyNameMap[service] || service;

            await new Promise<void>((resolve) => {
              rl.question(`🔑 Enter ${serviceName} Personal Access Token (or press Enter to go back): `, async (tokenInput) => {
                const token = tokenInput.trim();
                if (!token || token === '/back') {
                  console.log(chalk.gray('Cancelled.'));
                  runConnectMenu().then(resolve);
                  return;
                }

                process.stdout.write(`\n  ${themeOrange('⠋')} Validating ${serviceName} credentials...`);
                const { connectService } = await import('../pro/connect/index.js');
                try {
                  await connectService(service, token);
                  await connectService(storageKey, token);

                  try {
                    const { AuditLogStore } = await import('../pro/audit/index.js');
                    const auditStore = new AuditLogStore(indexer['db']);
                    auditStore.logAction({
                      service: 'connect',
                      operation: 'connect',
                      target: service,
                      payload_summary: `Connected ${serviceName}`,
                      payload_hash: crypto.createHash('sha256').update(token).digest('hex'),
                      status: 'completed'
                    });
                  } catch (_) {}

                  readline.clearLine(process.stdout, 0);
                  readline.cursorTo(process.stdout, 0);
                  console.log(chalk.green(`✓ Successfully connected ${serviceName}!`));
                } catch (e: any) {
                  readline.clearLine(process.stdout, 0);
                  readline.cursorTo(process.stdout, 0);
                  console.log(chalk.red(`✗ Failed: ${e.message}`));
                }
                resolve();
              });
            });
          }
        };

        await runConnectMenu();
        askQuestion();
        return;
      }

      if (command === '/audit') {
        const parts = arg.trim().split(/\s+/);
        const subCommand = parts[0].toLowerCase();
        const actionId = parts.slice(1).join(' ').trim();

        try {
          const { AuditLogStore } = await import('../pro/audit/index.js');
          const auditStore = new AuditLogStore(indexer['db']);

          if (subCommand === 'list' || !subCommand) {
            const logs = auditStore.getRecentLogs(15);
            console.log(`\n  ॐ  ${themePrimary.bold('unit01 audit log')}  ${themeGray('·  Recent Actions')}`);
            console.log('  ' + '─'.repeat(50));
            if (logs.length === 0) {
              console.log('  No audit logs recorded yet.');
            } else {
              logs.forEach(log => {
                const timeStr = new Date(log.timestamp).toLocaleTimeString();
                const statusSymbol = log.status === 'completed' || log.status === 'approved' ? chalk.green('✓') : chalk.red('✗');
                const svc = log.service.padEnd(10);
                const op = log.operation.padEnd(15);
                const target = log.target.length > 25 ? log.target.substring(0, 22) + '...' : log.target;
                console.log(`  [${timeStr}]  ${statusSymbol} ${svc} ${op} ${target.padEnd(25)} (ID: ${log.id.slice(0, 8)})`);
              });
            }
            console.log('  ' + '─'.repeat(50) + '\n');
          } else if (subCommand === 'inspect') {
            if (!actionId) {
              console.log(chalk.red('Usage: /audit inspect <action_id>'));
            } else {
              const logs = auditStore.getRecentLogs(100);
              const log = logs.find(l => l.id === actionId || l.id.startsWith(actionId));
              if (!log) {
                console.log(chalk.red(`Audit record ${actionId} not found.`));
              } else {
                console.log(`\n  ॐ  ${themePrimary.bold('unit01 audit record')}  ${themeGray('·  Inspect')}`);
                console.log('  ' + '─'.repeat(50));
                console.log(`  ${themeGray('ID').padEnd(15)} ${log.id}`);
                console.log(`  ${themeGray('Timestamp').padEnd(15)} ${new Date(log.timestamp).toLocaleString()}`);
                console.log(`  ${themeGray('Service').padEnd(15)} ${log.service}`);
                console.log(`  ${themeGray('Operation').padEnd(15)} ${log.operation}`);
                console.log(`  ${themeGray('Target').padEnd(15)} ${log.target}`);
                console.log(`  ${themeGray('Status').padEnd(15)} ${log.status}`);
                console.log(`  ${themeGray('Summary').padEnd(15)} ${log.payload_summary}`);
                console.log(`  ${themeGray('SHA256 Hash').padEnd(15)} ${log.payload_hash}`);
                console.log('  ' + '─'.repeat(50) + '\n');
              }
            }
          } else if (subCommand === 'undo') {
            if (!actionId) {
              console.log(chalk.red('Usage: /audit undo <action_id>'));
            } else {
              const logs = auditStore.getRecentLogs(100);
              const log = logs.find(l => l.id === actionId || l.id.startsWith(actionId));
              if (!log) {
                console.log(chalk.red(`Audit record ${actionId} not found.`));
              } else {
                console.log(chalk.yellow(`Attempting to undo action ${log.id.slice(0, 8)}...`));
                const res = await auditStore.undoAction(log.id);
                if (res.success) {
                  console.log(chalk.green(`✓ ${res.message}`));
                } else {
                  console.log(chalk.red(`✗ ${res.message}`));
                }
              }
            }
          } else {
            console.log(chalk.red('Unknown subcommand. Available: list, inspect, undo'));
          }
        } catch (e: any) {
          console.log(chalk.red(`Failed to execute audit command: ${e.message}`));
        }
        askQuestion();
        return;
      }

      if (command === '/reset-password') {
        if (process.platform === 'darwin') {
          console.log(chalk.yellow('Master Password is only used on Linux. macOS Keychain uses system credentials.'));
        } else {
          await new Promise<void>((resolve) => {
            rl.question('Enter 24-character Master Recovery Key (UNIT01-XXXX-XXXX-...): ', (recKey) => {
              const recoveryKey = recKey.trim();
              rl.question('Enter your new Master Password: ', async (newPass) => {
                const password = newPass.trim();
                const { resetVaultPassword } = await import('../pro/connect/vault.js');
                if (resetVaultPassword(recoveryKey, password)) {
                  console.log(chalk.green('✓ Master Password successfully reset!'));
                } else {
                  console.log(chalk.red('✗ Failed to reset password. Ensure the recovery key is correct.'));
                }
                resolve();
              });
            });
          });
        }
        askQuestion();
        return;
      }

      if (command === '/autopilot') {
        const chosenIdx = await interactiveSelect('Autopilot Mode:', [
          `Enable Autopilot (Plan-Code-Test-Healing Loop)  ${autopilotEnabled ? '✓' : ''}`,
          `Disable Autopilot ${!autopilotEnabled ? '✓' : ''}`
        ]);
        
        if (chosenIdx === 0) {
          autopilotEnabled = true;
          console.log(chalk.cyan('🤖 Autopilot enabled. Code edits will run in Plan-Code-Test-Healing loop.'));
        } else if (chosenIdx === 1) {
          autopilotEnabled = false;
          console.log(chalk.yellow('🤖 Autopilot disabled.'));
        }
        askQuestion();
        return;
      }

      if (command === '/compact') {
        await runCompaction(false);
        askQuestion();
        return;
      }

      if (command === '/changes') {
        const changes = indexer.getRecentChanges();
        console.log(changes ? chalk.blue(changes) : chalk.gray('No recent changes logged.'));
        askQuestion();
        return;
      }

      if (command === '/search') {
        const runSearch = (queryStr: string) => {
          const results = indexer.search(queryStr);
          console.log(chalk.blue(`Found ${results.length} matches:`));
          results.slice(0, 5).forEach((r) => {
            console.log(chalk.cyan(`- ${r.relpath} (line ${r.start_line}-${r.end_line})`));
          });
        };

        if (!arg) {
          await new Promise<void>((resolve) => {
            rl.question('Enter search query: ', (query) => {
              const searchArg = query.trim();
              if (!searchArg) {
                console.log(chalk.red('Search cancelled: empty query.'));
              } else {
                runSearch(searchArg);
              }
              resolve();
            });
          });
        } else {
          runSearch(arg);
        }
        askQuestion();
        return;
      }

      if (command === '/undo') {
        const dbBackup = indexer['db']['db'].prepare('SELECT original_path FROM shadow_backups LIMIT 1').get() as { original_path: string } | undefined;
        if (dbBackup) {
          const restoredPath = dbBackup.original_path;
          const success = indexer.undoWrite(restoredPath);
          if (success) {
            sandbox.clearLoopHistory();
            console.log(chalk.cyan(`Successfully restored backup and reverted changes for: ${path.basename(restoredPath)}`));
          } else {
            console.log(chalk.red(`Failed to restore backup for ${restoredPath}`));
          }
        } else {
          console.log(chalk.gray('No backups found to undo.'));
        }
        askQuestion();
        return;
      }

      if (command === '/models') {
        let cleanedArg = arg ? arg.trim() : '';
        if (cleanedArg.startsWith('<') && cleanedArg.endsWith('>')) {
          cleanedArg = cleanedArg.slice(1, -1).trim();
        }

        if (cleanedArg) {
          const matchIndex = models.findIndex(m => m.name === cleanedArg);
          const numVal = parseInt(cleanedArg, 10);
          const matchNum = !isNaN(numVal) && numVal > 0 && numVal <= models.length ? numVal - 1 : -1;

          const targetIdx = matchIndex !== -1 ? matchIndex : matchNum;
          if (targetIdx !== -1) {
            activeModel = models[targetIdx].name;
            contextLimit = await ollama.getContextLimit(activeModel);
            console.log(chalk.cyan(`Switched to active model: ${activeModel}`));
            try {
              sessionStore.save(sessionId, { startedAt: sessionStartTime, activeModel, conversationHistory });
            } catch (e) {}
          } else {
            printSystemMessage('error', `Model "${cleanedArg}" not found in local library.`);
          }
          askQuestion();
        } else {
          const options = models.map((m) => {
            const pSize = m.details.parameter_size || 'unknown';
            const activeIndicator = m.name === activeModel ? ' (active)' : '';
            return `${m.name} (${pSize})${activeIndicator}`;
          });
          const chosenIdx = await interactiveSelect('Select Active Model:', options);
          if (chosenIdx !== -1) {
            activeModel = models[chosenIdx].name;
            contextLimit = await ollama.getContextLimit(activeModel);
            console.log(chalk.cyan(`Switched to active model: ${activeModel}`));
            try {
              sessionStore.save(sessionId, { startedAt: sessionStartTime, activeModel, conversationHistory });
            } catch (e) {}
          } else {
            console.log(chalk.gray('Model selection cancelled.'));
          }
          askQuestion();
        }
        return;
      }

      if (command === '/thinking') {
        const chosenIdx = await interactiveSelect('Model Thinking Mode:', [
          `Enable Thinking  ${thinkingEnabled ? '✓' : ''}`,
          `Disable Thinking ${!thinkingEnabled ? '✓' : ''}`
        ]);
        
        if (chosenIdx === 0) {
          thinkingEnabled = true;
          console.log(chalk.cyan('🧠 Model thinking enabled (reasoning blocks will be displayed).'));
        } else if (chosenIdx === 1) {
          thinkingEnabled = false;
          console.log(chalk.yellow('🧠 Model thinking disabled (reasoning blocks will be hidden).'));
        }
        askQuestion();
        return;
      }

      if (command === '/preview') {
        if (state.lastWrittenFile) {
          if (state.lastWrittenFile.original === null) {
            renderNewFileBlock(state.lastWrittenFile.content, getLanguageFromFilename(state.lastWrittenFile.filePath), state.lastWrittenFile.filePath);
          } else {
            renderSideBySideDiff(state.lastWrittenFile.original, state.lastWrittenFile.content, getLanguageFromFilename(state.lastWrittenFile.filePath), state.lastWrittenFile.filePath);
          }
        } else {
          console.log(chalk.gray('No pending or recently written files to preview.'));
        }
        askQuestion();
        return;
      }

      if (command === '/status') {
        const activeRepoMap = indexer.getRepoMap();
        const activeChanges = indexer.getRecentChanges();
        const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
        const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
        const ratio = Math.min(totalTokens / contextLimit, 1.0);
        
        const filesCount = indexer['db'].getAllFiles().length;
        const ratioPct = Math.round(ratio * 100);
        
        let displayWorkspace = workspaceRoot;
        if (workspaceRoot.startsWith(os.homedir())) {
          displayWorkspace = '~' + workspaceRoot.slice(os.homedir().length);
        }

        const cols = process.stdout.columns || 80;
        const rule = '  ' + '─'.repeat(Math.min(cols - 4, 40));
        
        console.log('\n' + rule);
        console.log(`  ${themePrimary('◈')} ${themePrimary.bold('unit01')} ${themeGray(' ·  system status')}`);
        console.log(rule);
        console.log(`  ${themeGray('model').padEnd(12)} ${activeModel}`);
        console.log(`  ${themeGray('context').padEnd(12)} ${totalTokens.toLocaleString()} / ${contextLimit.toLocaleString()} tokens  (${ratioPct}%)`);
        console.log(`  ${themeGray('workspace').padEnd(12)} ${displayWorkspace}`);
        console.log(`  ${themeGray('branch').padEnd(12)} ${gitBranch}`);
        console.log(`  ${themeGray('files').padEnd(12)} ${filesCount}`);
        console.log(rule + '\n');
        
        askQuestion();
        return;
      }

      if (command === '/usage') {
        const activeRepoMap = indexer.getRepoMap();
        const activeChanges = indexer.getRecentChanges();
        const systemPromptLength = estimateTokens(SYSTEM_INSTRUCTIONS + activeRepoMap + activeChanges);
        const historyLength = conversationHistory.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const totalTokens = lastInputTokens > 0 ? lastInputTokens : (systemPromptLength + historyLength);
        const ratio = Math.min(totalTokens / contextLimit, 1.0);
        const pct = Math.round(ratio * 100);
        
        let fillColor = themeGold;
        if (ratio >= 0.8) {
          fillColor = themeRed;
        } else if (ratio >= 0.6) {
          fillColor = themeGold;
        }
        
        const barWidth = 20;
        const filledWidth = Math.round(ratio * barWidth);
        const emptyWidth = barWidth - filledWidth;
        const bar = fillColor('█'.repeat(filledWidth)) + themeGray('░'.repeat(emptyWidth));
        
        const formatK = (tokens: number) => {
          if (tokens >= 1000) {
            return `${Math.round(tokens / 1000)}k`;
          }
          return tokens.toString();
        };
        
        const cols = process.stdout.columns || 80;
        const rule = '  ' + '─'.repeat(Math.min(cols - 4, 40));
        console.log('\n  ' + themeGray('context window'));
        console.log(rule);
        console.log(`  [${bar}]  ${pct}%  ${themeGray('·')}  ${formatK(totalTokens)} / ${formatK(contextLimit)}`);
        console.log();

        askQuestion();
        return;
      }

      if (command === '/files') {
        const allFiles = indexer['db'].getAllFiles();
        console.log(chalk.bold(`\nIndexed Files (${allFiles.length}):`));
        allFiles.forEach(f => {
          const rel = path.relative(workspaceRoot, f.path);
          console.log(`  - ${chalk.cyan(rel)} (${chalk.gray((f.size / 1024).toFixed(1) + ' KB')})`);
        });
        console.log();
        askQuestion();
        return;
      }

      if (command === '/reindex') {
        console.log(chalk.yellow('Re-scanning workspace and rebuilding index...'));
        await indexer.initialize();
        console.log(chalk.cyan('Index successfully rebuilt.'));
        askQuestion();
        return;
      }

      if (command === '/help') {
        const cols = process.stdout.columns || 80;
        const rule = '  ' + '─'.repeat(Math.min(cols - 4, 40));
        console.log('\n' + rule);
        console.log(`  ${themePrimary('◈')} ${themePrimary.bold('unit01')} ${themeGray(' ·  help')}`);
        console.log(rule);
        
        const helpCommands = [
          { cmd: '/models', desc: 'switch the active model' },
          { cmd: '/thinking', desc: 'toggle reasoning blocks' },
          { cmd: '/status', desc: 'system info' },
          { cmd: '/usage', desc: 'context window usage' },
          { cmd: '/sessions', desc: 'browse saved sessions' },
          { cmd: '/compact', desc: 'compress context' },
          { cmd: '/clear', desc: 'clear conversation' },
          { cmd: '/connect', desc: 'manage secure service connections' },
          { cmd: '/audit', desc: 'view and undo secure audit trail actions' },
          { cmd: '/autopilot', desc: 'toggle Plan-Code-Test self-healing pipeline' },
          { cmd: '/reset-password', desc: 'reset vault password (Linux)' },
          { cmd: '/help', desc: 'show this menu' },
          { cmd: '/exit', desc: 'quit unit01' },
          { cmd: '/files', desc: 'list indexed files' },
          { cmd: '/reindex', desc: 're-index workspace' },
          { cmd: '/export', desc: 'export session' },
          { cmd: '/preview', desc: 'preview last file' },
          { cmd: '/changes', desc: 'view recent changes' },
          { cmd: '/undo', desc: 'revert last change' },
          { cmd: '/search', desc: 'search codebase' }
        ];

        for (const item of helpCommands) {
          console.log(`  ${themePrimary(item.cmd.padEnd(14))}${themeGray(item.desc)}`);
        }
        console.log(rule + '\n');
        
        askQuestion();
        return;
      }

      printSystemMessage('error', `Unknown command: ${command}`);
      askQuestion();
      return;
    }

    conversationHistory.push({ role: 'user', content: trimmed });

    // Run recursive LLM agent generation loop
    let loopDepth = 0;
    const runAgentLoop = async (shouldExit = false) => {
      loopDepth++;
      if (loopDepth > 15) {
        printSystemMessage('guard', 'Maximum tool iteration depth of 15 reached. Stopping loop to prevent resource drain.');
        if (shouldExit) {
          indexer.close();
          sandbox.stop();
          rl.close();
          process.exit(1);
        } else {
          askQuestion();
        }
        return;
      }

      if (indexer && (indexer as any).watcher) {
        try {
          (indexer as any).watcher.flush();
        } catch (e) {}
      }

      const currentRepoMap = indexer.getRepoMap();
      const currentChanges = indexer.getRecentChanges();

      let routedModel = activeModel;
      try {
        const { routeTaskModel } = await import('../pro/autopilot/index.js');
        const target = routeTaskModel(conversationHistory[conversationHistory.length - 1]?.content || '', activeModel);
        routedModel = target.modelName;
        if (target.tier !== 'local-main') {
          console.log(chalk.cyan(`  🧠 [Autopilot Router] ${target.reason} (routed to ${routedModel})`));
        }
      } catch (e) {}

      let memoryBlock = '';
      try {
        const { ProjectMemoryStore } = await import('../pro/memory/index.js');
        const memoryStore = new ProjectMemoryStore(indexer['db']);
        memoryBlock = memoryStore.generateMemoryContextBlock();
      } catch (e) {}
      
      const systemMessage = {
        role: 'system',
        content: `${SYSTEM_INSTRUCTIONS}\n\n[Active Repository Map]\n${currentRepoMap}\n\n${currentChanges}${memoryBlock}`
      };

      const activePayload = [systemMessage, ...conversationHistory];

      let modelResponse = '';
      let isFirstChunk = true;
      let bufferedText = '';
      let inThinkBlock = false;
      let tempBuffer = '';
      const spinnerStartTime = Date.now();
      const minDelay = isGui ? 0 : 2000; // 2 seconds minimum thinking display

      const spinner = new ThinkingSpinner();
      if (!isGui) {
        process.stdout.write('\n');
        spinner.start();
      }

      let lastProcessedIndex = 0;
      let inThink = false;
      let streamAccumulator = '';
      let printedStreamText = '';
      const streamState = {
        buffer: '',
        suppressed: false,
        inCodeBlock: false
      };

      const toolSpinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let toolSpinnerIdx = 0;
      let toolSpinnerStarted = false;
      let toolSpinnerLinePrinted = false;

      const filterPrint = (text: string) => {
        if (isGui) return;
        const toPrint = processChunk(text, streamState);
        if (toPrint) {
          process.stdout.write(toPrint);
          printedStreamText += toPrint;
        }
        
        if (streamState.suppressed) {
          if (!toolSpinnerStarted) {
            toolSpinnerStarted = true;
            process.stdout.write(`\n  ${themeOrange(toolSpinnerFrames[0])} preparing tool call...`);
            toolSpinnerLinePrinted = true;
          } else {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            toolSpinnerIdx = (toolSpinnerIdx + 1) % toolSpinnerFrames.length;
            
            // Extract details from streamAccumulator
            const writeMatch = /<write_file\s+(?:relative_)?path=["']([^"']+)["']\s*>([\s\S]*?)(?:<\/write_file>|$)/.exec(streamAccumulator);
            let statusMsg = '';
            if (writeMatch) {
              const fileName = writeMatch[1];
              const contentSoFar = writeMatch[2];
              const charCount = contentSoFar.length;
              const lineCount = contentSoFar.split(/\r?\n/).length;
              statusMsg = `${themeAccent('write')} ${fileName} (${themeAccent(charCount.toLocaleString())} chars, ${themeAccent(lineCount)} lines)...`;
            } else {
              const runMatch = /<run_command\s*>([\s\S]*?)(?:<\/run_command>|$)/.exec(streamAccumulator);
              if (runMatch) {
                const cmdSoFar = runMatch[1].trim().replace(/\n/g, ' ');
                statusMsg = `${themePrimary('run')} ${cmdSoFar.substring(0, 50)}${cmdSoFar.length > 50 ? '...' : ''}...`;
              } else {
                let fileSoFar = '';
                const readAttrMatch = /<read_file\s+(?:relative_)?path=["']([^"']+)["']\s*\/?>/.exec(streamAccumulator);
                if (readAttrMatch) {
                  fileSoFar = readAttrMatch[1];
                } else {
                  const readTagMatch = /<read_file\s*>([\s\S]*?)(?:<\/read_file>|$)/.exec(streamAccumulator);
                  if (readTagMatch) {
                    fileSoFar = readTagMatch[1].trim();
                  }
                }
                
                if (fileSoFar) {
                  statusMsg = `${themeAccent('read')} ${fileSoFar}...`;
                } else {
                  const searchMatch = /<search_code\s*>([\s\S]*?)(?:<\/search_code>|$)/.exec(streamAccumulator);
                  if (searchMatch) {
                    const querySoFar = searchMatch[1].trim();
                    statusMsg = `${themeAccent('search')} index for "${querySoFar}"...`;
                  } else {
                    statusMsg = `preparing tool call...`;
                  }
                }
              }
            }
            
            process.stdout.write(`  ${themeOrange(toolSpinnerFrames[toolSpinnerIdx])} ${statusMsg}`);
          }
        }
      };

      const abortController = new AbortController();
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;
      const hasRawMode = typeof stdin.setRawMode === 'function';

      const onKeypress = (str: any, key: any) => {
        if (key) {
          if (key.name === 'escape') {
            abortController.abort();
          } else if (key.ctrl && key.name === 'c') {
            if (hasRawMode) {
              try {
                stdin.removeListener('keypress', onKeypress);
                stdin.setRawMode(wasRaw);
              } catch (_) {}
            }
            process.exit(130);
          }
        }
      };

      if (hasRawMode) {
        try {
          stdin.setRawMode(true);
          stdin.resume();
          readline.emitKeypressEvents(stdin);
          stdin.on('keypress', onKeypress);
        } catch (_) {}
      }

      try {
        try {
          const chatResult = await ollama.chatStream(
            routedModel,
            activePayload,
            contextLimit,
            (chunk) => {
              streamAccumulator += chunk;
              if (hasRepetitionLoop(streamAccumulator)) {
                throw new Error('REPETITION_LOOP');
              }

              if (isGui) {
                let i = lastProcessedIndex;
                while (i < streamAccumulator.length) {
                  if (!inThink) {
                    const thinkStart = streamAccumulator.indexOf('<think>', i);
                    if (thinkStart === i) {
                      inThink = true;
                      i += 7;
                      continue;
                    }

                    const remaining = streamAccumulator.slice(i);
                    if ('<think>'.startsWith(remaining) && remaining.length < 7) {
                      break;
                    }

                    const nextThink = streamAccumulator.indexOf('<think>', i);
                    const endPos = nextThink !== -1 ? nextThink : streamAccumulator.length;

                    let limit = endPos;
                    for (let p = 1; p < 7; p++) {
                      if (i + p < streamAccumulator.length) {
                        const part = streamAccumulator.slice(streamAccumulator.length - p);
                        if ('<think>'.startsWith(part)) {
                          limit = streamAccumulator.length - p;
                          break;
                        }
                      }
                    }

                    if (limit > i) {
                      const textEmit = streamAccumulator.slice(i, limit);
                      guiEmit({ type: 'message-chunk', text: textEmit });
                      i = limit;
                    } else {
                      break;
                    }
                  } else {
                    const thinkEnd = streamAccumulator.indexOf('</think>', i);
                    if (thinkEnd === i) {
                      inThink = false;
                      i += 8;
                      continue;
                    }

                    const remaining = streamAccumulator.slice(i);
                    if ('</think>'.startsWith(remaining) && remaining.length < 8) {
                      break;
                    }

                    const nextEnd = streamAccumulator.indexOf('</think>', i);
                    const endPos = nextEnd !== -1 ? nextEnd : streamAccumulator.length;

                    let limit = endPos;
                    for (let p = 1; p < 8; p++) {
                      if (i + p < streamAccumulator.length) {
                        const part = streamAccumulator.slice(streamAccumulator.length - p);
                        if ('</think>'.startsWith(part)) {
                          limit = streamAccumulator.length - p;
                          break;
                        }
                      }
                    }

                    if (limit > i) {
                      const textEmit = streamAccumulator.slice(i, limit);
                      guiEmit({ type: 'thought-chunk', text: textEmit });
                      i = limit;
                    } else {
                      break;
                    }
                  }
                }
                lastProcessedIndex = i;
                return;
              }

              const elapsed = Date.now() - spinnerStartTime;
              if (elapsed < minDelay) {
                bufferedText += chunk;
              } else {
                if (isFirstChunk) {
                  isFirstChunk = false;
                  spinner.stop();
                  process.stdout.write(`${themeAccent('●')} `);
                  printedStreamText += '● ';
                  if (bufferedText) {
                    let textToPrint = bufferedText;
                    if (!thinkingEnabled) {
                      textToPrint = textToPrint.replace(/<think>[\s\S]*?<\/think>/g, '');
                      const startIdx = textToPrint.indexOf('<think>');
                      if (startIdx !== -1) {
                        inThinkBlock = true;
                        tempBuffer = textToPrint.substring(startIdx);
                        textToPrint = textToPrint.substring(0, startIdx);
                      }
                    }
                    if (textToPrint) {
                      filterPrint(textToPrint);
                    }
                    bufferedText = '';
                  }
                }
                
                if (!thinkingEnabled) {
                  tempBuffer += chunk;
                  if (!inThinkBlock) {
                    const thinkStartIdx = tempBuffer.indexOf('<think>');
                    if (thinkStartIdx !== -1) {
                      const before = tempBuffer.substring(0, thinkStartIdx);
                      if (before) filterPrint(before);
                      inThinkBlock = true;
                      tempBuffer = tempBuffer.substring(thinkStartIdx);
                    } else {
                      filterPrint(tempBuffer);
                      tempBuffer = '';
                    }
                  }
                  
                  if (inThinkBlock) {
                    const thinkEndIdx = tempBuffer.indexOf('</think>');
                    if (thinkEndIdx !== -1) {
                      inThinkBlock = false;
                      const after = tempBuffer.substring(thinkEndIdx + 8);
                      if (after) filterPrint(after);
                      tempBuffer = '';
                    } else {
                      const partialTagMatch = /<\/t?h?i?n?k?>?$/.exec(tempBuffer);
                      if (partialTagMatch) {
                        tempBuffer = partialTagMatch[0];
                      } else {
                        tempBuffer = '';
                      }
                    }
                  }
                } else {
                  filterPrint(chunk);
                }
              }
            },
            abortController.signal
          );
          modelResponse = chatResult.content;
          const usage = chatResult.usage;
          lastInputTokens = usage.input_tokens;

          const isCompactionSkipped = currentOperation === '/summary' || currentOperation === '/export' || currentOperation === '/sessions';
          if (!isCompactionSkipped) {
            const usageRatio = usage.input_tokens / contextLimit;
            if (usageRatio >= compactThreshold) {
              pendingCompaction = true;
            }
          }

          // If the model finished before the minimum spinner delay, wait and flush
          const elapsed = Date.now() - spinnerStartTime;
          if (elapsed < minDelay) {
            const remaining = minDelay - elapsed;
            await new Promise(resolve => setTimeout(resolve, remaining));
            isFirstChunk = false;
            spinner.stop();
            process.stdout.write(`${themeAccent('●')} `);
            printedStreamText += '● ';
            if (bufferedText) {
              let textToPrint = bufferedText;
              if (!thinkingEnabled) {
                textToPrint = textToPrint.replace(/<think>[\s\S]*?<\/think>/g, '');
              }
              if (textToPrint) {
                filterPrint(textToPrint);
              }
            }
          } else {
            spinner.stop();
          }
        } finally {
          if (hasRawMode) {
            try {
              stdin.removeListener('keypress', onKeypress);
              stdin.setRawMode(wasRaw);
            } catch (_) {}
          }
        }
      } catch (err: any) {
        spinner.stop();
        if (err.message === 'REPETITION_LOOP') {
          if (toolSpinnerLinePrinted) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            readline.moveCursor(process.stdout, 0, -1);
          }
          const cols = process.stdout.columns || 80;
          const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
          if (linesToClear > 0) {
            readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
            readline.cursorTo(process.stdout, 0);
            readline.clearScreenDown(process.stdout);
          }
          printSystemMessage('guard', 'Generation aborted: text repetition loop detected.');
          conversationHistory.push({
            role: 'system',
            content: '[SYSTEM] Generation aborted due to repeating text. Please generate your response concisely without repetitions.'
          });
          await runAgentLoop(shouldExit);
          return;
        }

        if (toolSpinnerLinePrinted) {
          readline.clearLine(process.stdout, 0);
          readline.cursorTo(process.stdout, 0);
          readline.moveCursor(process.stdout, 0, -1);
        }
        const cols = process.stdout.columns || 80;
        const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
        if (linesToClear > 0) {
          readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
          readline.cursorTo(process.stdout, 0);
          readline.clearScreenDown(process.stdout);
        }

        const isAbort = err.name === 'AbortError' || 
                        err.message?.includes('aborted') || 
                        err.message?.includes('Abort');

        if (isAbort) {
          printSystemMessage('stop', 'Generation interrupted.');
          if (shouldExit) {
            indexer.close();
            sandbox.stop();
            rl.close();
            process.exit(130);
          } else {
            askQuestion();
          }
          return;
        }

        printSystemMessage('error', `Connection failed: ${err.message}`);
        if (shouldExit) {
          indexer.close();
          sandbox.stop();
          rl.close();
          process.exit(1);
        } else {
          askQuestion();
        }
        return;
      }

      // Clean up tool spinner line if printed
      if (toolSpinnerLinePrinted) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        readline.moveCursor(process.stdout, 0, -1);
      }

      // Clear raw stream output and print formatted markdown response
      const cols = process.stdout.columns || 80;
      const linesToClear = printedStreamText ? countVisualLines(printedStreamText, cols) : 0;
      if (linesToClear > 0) {
        readline.moveCursor(process.stdout, 0, -(linesToClear - 1));
        readline.cursorTo(process.stdout, 0);
        readline.clearScreenDown(process.stdout);
      }

      // Strip tool tags so only the explanation text is rendered as markdown
      let cleanText = modelResponse
        .replace(/<run_command\s*>[\s\S]*?(?:<\/run_command>|$)/g, '')
        .replace(/<read_file\s*[^>]*>[\s\S]*?(?:<\/read_file>|$)/g, '')
        .replace(/<search_code\s*>[\s\S]*?(?:<\/search_code>|$)/g, '')
        .replace(/<web_search\s*>[\s\S]*?(?:<\/web_search>|$)/g, '')
        .replace(/<write_file\s*[^>]*>[\s\S]*?(?:<\/write_file>|$)/g, '')
        .replace(/<patch_file\s*[^>]*>[\s\S]*?(?:<\/patch_file>|$)/g, '')
        .replace(/<patch_file_blocks\s*[^>]*>[\s\S]*?(?:<\/patch_file_blocks>|$)/g, '')
        .replace(/<list_dir\s*[^>]*>[\s\S]*?(?:<\/list_dir>|$)/g, '')
        .replace(/<git_status\s*[^>]*>[\s\S]*?(?:<\/git_status>|$)/g, '')
        .replace(/<diagnostics\s*[^>]*>[\s\S]*?(?:<\/diagnostics>|$)/g, '')
        .replace(/<move_file\s*[^>]*>[\s\S]*?(?:<\/move_file>|$)/g, '')
        .replace(/<(?:path_)?question\s*[^>]*\/>/g, '')
        .replace(/<(?:path_)?question\s*[^>]*>[\s\S]*?(?:<\/(?:path_)?question>|$)/g, '')
        .replace(/<decision\s*[^>]*>[\s\S]*?(?:<\/decision>|$)/g, '')
        .replace(/<convention\s*[^>]*>[\s\S]*?(?:<\/convention>|$)/g, '')
        .trim();

      if (!thinkingEnabled) {
        cleanText = cleanText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      } else {
        // Format think blocks nicely in slate-gray side-bordered box
        cleanText = cleanText.replace(/<think>([\s\S]*?)<\/think>/g, (_, thinkContent) => {
          const trimmed = thinkContent.trim();
          if (!trimmed) return '';
          const bordered = trimmed.split('\n').map((l: string) => `  ${themeGray('│')} ${themeGray.italic(l)}`).join('\n');
          return `\n\n  ${themeGray.bold('🧠 Thinking:')}\n${bordered}\n\n`;
        }).trim();
      }

      if (cleanText && !isGui) {
        const formatted = renderMarkdown(cleanText);
        console.log(`${themeAccent('●')} ${formatted}`);
      }

      // Connect Tier: Auto-intercept decisions & conventions tags in model response
      try {
        const decisionMatch = /<decision\s+category=["']([^"']+)["']\s+summary=["']([^"']+)["']\s*>([\s\S]*?)<\/decision>/i.exec(modelResponse);
        if (decisionMatch) {
          const category = decisionMatch[1] as any;
          const summary = decisionMatch[2];
          const rationale = decisionMatch[3].trim();
          const { ProjectMemoryStore } = await import('../pro/memory/index.js');
          const memoryStore = new ProjectMemoryStore(indexer['db']);
          memoryStore.logDecision({
            category,
            summary,
            rationale,
            context_files: []
          });
          console.log(chalk.cyan(`  🧠 [Project Memory] Saved decision: "${summary}"`));
        }

        const conventionMatch = /<convention\s+key=["']([^"']+)["']\s*>([\s\S]*?)<\/convention>/i.exec(modelResponse);
        if (conventionMatch) {
          const key = conventionMatch[1];
          const pattern = conventionMatch[2].trim();
          const { ProjectMemoryStore } = await import('../pro/memory/index.js');
          const memoryStore = new ProjectMemoryStore(indexer['db']);
          memoryStore.upsertConvention(key, pattern);
          console.log(chalk.cyan(`  🧠 [Project Memory] Saved coding convention: [${key}]`));
        }
      } catch (e) {}

      // Connect Tier Feature: Local Semantic Search background indexing updates
      try {
        const { indexMissingEmbeddings } = await import('../pro/search/index.js');
        await indexMissingEmbeddings(indexer['db']);
      } catch (e) {}

      // Parse tool calls in output
      const toolResult = await handleToolCalls(modelResponse, sandbox, indexer, rl, state);
      
      // Connect Tier Feature: Structured Build & Self-Healing loop
      let isVerifyPassed = true;
      if (autopilotEnabled && toolResult.toolRun && (modelResponse.includes('<patch_file') || modelResponse.includes('<write_file'))) {
        try {
          const { StructuredBuildPipeline } = await import('../pro/autopilot/pipeline.js');
          const testCommand = loadConfig(workspaceRoot).test_command || 'npm test';
          const pipeline = new StructuredBuildPipeline(workspaceRoot, testCommand, 5);
          
          console.log(chalk.cyan(`🤖 [Autopilot] Running test verification command: "${testCommand}"...`));
          const result = await pipeline.executePipeline(
            async () => {
              // Edits are written directly to working folder in this interactive shell mode
            },
            async (errorLog) => {
              console.log(chalk.red(`🤖 [Autopilot] Self-healing iteration triggered. Feeding error output back to model.`));
              toolResult.nextPrompt = `<tool_output>\nVerification command failed:\n${errorLog}\n\nPlease self-heal and resolve this compilation/test failure by adjusting the code.\n</tool_output>`;
              return true;
            }
          );
          if (!result.success) {
            isVerifyPassed = false;
          }
        } catch (e) {}
      }

      if (toolResult.toolRun) {
        conversationHistory.push({ role: 'assistant', content: modelResponse });
        try {
          sessionStore.save(sessionId, { startedAt: sessionStartTime, activeModel, conversationHistory });
        } catch (e) {}
        conversationHistory.push({ role: 'user', content: toolResult.nextPrompt });
        await runAgentLoop(shouldExit);
      } else {
        conversationHistory.push({ role: 'assistant', content: modelResponse });
        try {
          sessionStore.save(sessionId, { startedAt: sessionStartTime, activeModel, conversationHistory });
        } catch (e) {}
        
        if (pendingCompaction) {
          await runCompaction(true);
        }

        console.log('\n');
        if (shouldExit) {
          indexer.close();
          sandbox.stop();
          rl.close();
          process.exit(0);
        } else {
          askQuestion();
        }
      }
    };

    await runAgentLoop(state.isNonInteractive);
  };

  if (state.isNonInteractive) {
    conversationHistory.push({ role: 'user', content: nonInteractivePrompt! });
    await runCompaction(true); // run dynamic context estimation checks
  } else {
    askQuestion();
  }
}

startCli().catch(err => {
  printSystemMessage('error', `CLI failed to initialize: ${err.message || err}`);
});
