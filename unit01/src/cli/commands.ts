import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { DirectiveIndexer } from '../core/indexer/index.js';
import { DirectiveSandbox } from '../core/security/sandbox.js';
import { buildRepoMap } from '../core/indexer/repomap.js';
import { AllowedPath } from '../core/security/types.js';
import { ChunkRecord } from '../core/database/db.js';
import {
  themePrimary,
  themeOrange,
  themeAccent,
  themeGray,
  themeRed,
  isGui,
  guiEmit
} from './views/theme.js';
import {
  printToolResult,
  printSystemMessage,
  interactiveConfirmWrite,
  interactiveSelect
} from './views/components.js';
import {
  renderSideBySideDiff,
  renderNewFileBlock
} from './views/diff.js';
import {
  parseRunCommand,
  parseWriteFile,
  parseReadFile,
  parseSearchCode,
  parseWebSearch,
  parsePatchFile,
  parsePatchFileBlocks,
  parseListDir,
  parseGitStatus,
  parseDiagnosticsTag,
  parseMoveFile,
  parseQuestion,
  validateToolCall,
  getLanguageFromFilename,
  applySearchReplaceBlocks,
  listDirectory,
  parseDiagnostics
} from './parser.js';

export interface CliState {
  lastWrittenFile: {
    filePath: string;
    original: string | null;
    content: string;
  } | null;
  activeAllowedPaths: AllowedPath[];
  isNonInteractive: boolean;
}

export async function handleToolCalls(
  text: string,
  sandbox: DirectiveSandbox,
  indexer: DirectiveIndexer,
  rl: readline.Interface,
  state: CliState
): Promise<{ toolRun: boolean; nextPrompt: string; consoleOutput: string }> {
  // Parse and validate all XML/HTML tags
  const openTagRegex = /<([a-zA-Z_][a-zA-Z0-9_\-]*)([^>]*)>/g;
  let match;
  while ((match = openTagRegex.exec(text))) {
    const tagName = match[1];
    const attributesStr = match[2];
    
    // Check if tag is a tool
    const isTool = tagName === 'run_command' || tagName === 'read_file' || tagName === 'write_file' || tagName === 'search_code' ||
                   tagName === 'sandbox_exec' || tagName === 'question' || tagName === 'path_question';
    
    if (isTool) {
      const errorMsg = validateToolCall(tagName, attributesStr);
      if (errorMsg) {
        console.log(`\n  ${chalk.red('✗')} tool call ${chalk.yellow(`<${tagName}>`)} (blocked: invalid/wrong arguments)`);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${errorMsg}\n</tool_output>`,
          consoleOutput: `\n[Tool call blocked: <${tagName}>]`
        };
      }
    }
  }

  const runCmd = parseRunCommand(text);
  if (runCmd !== null) {
    const cmd = runCmd;
    if (isGui) guiEmit({ type: 'tool-call', tool: 'run_command', command: cmd });
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themePrimary('run')} ${cmd} ...`);
    const output = await sandbox.runCommand(cmd);
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);

    if (output.startsWith('[DIRECTIVE AI]')) {
      printToolResult('failure', `Ran: ${cmd} (blocked)`);
      printSystemMessage('guard', `command blocked  ·  ${cmd}`);
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('../pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer['db']);
        const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
        auditStore.logAction({
          service: 'shell',
          operation: 'execute_script',
          target: cmd,
          payload_summary: `Command blocked by sandbox: ${cmd}`,
          payload_hash: payloadHash,
          status: 'denied'
        });
      } catch (_) {}
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Blocked: ${cmd}]`
      };
    }

    if (output.startsWith('{') && output.includes('FILE_NOT_WRITTEN')) {
      printToolResult('failure', `Ran: ${cmd} (failed: file not written)`);
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('../pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer['db']);
        const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
        auditStore.logAction({
          service: 'shell',
          operation: 'execute_script',
          target: cmd,
          payload_summary: `Failed to execute command (file not written)`,
          payload_hash: payloadHash,
          status: 'failed'
        });
      } catch (_) {}
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${output}\n</tool_output>`,
        consoleOutput: `\n[Failed: ${cmd}]`
      };
    }

    if (output.startsWith('[Command failed with exit code')) {
      const match = output.match(/exit code (\d+)/);
      const exitCode = match ? match[1] : '1';
      printToolResult('failure', `Ran: ${cmd} (exit ${exitCode})`);
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('../pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer['db']);
        const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
        auditStore.logAction({
          service: 'shell',
          operation: 'execute_script',
          target: cmd,
          payload_summary: `Command failed with exit code ${exitCode}`,
          payload_hash: payloadHash,
          status: 'failed'
        });
      } catch (_) {}
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${output.trim()}\n</tool_output>`,
        consoleOutput: `\n[Failed: ${cmd}]`
      };
    }

    printToolResult('success', `Ran: ${cmd} (exit 0)`);
    const outputResult = output.trim() || 'Command executed successfully with no output.';
    try {
      const crypto = await import('crypto');
      const { AuditLogStore } = await import('../pro/audit/index.js');
      const auditStore = new AuditLogStore(indexer['db']);
      const payloadHash = crypto.createHash('sha256').update(cmd).digest('hex');
      auditStore.logAction({
        service: 'shell',
        operation: 'execute_script',
        target: cmd,
        payload_summary: outputResult.length > 100 ? outputResult.substring(0, 100) + '...' : outputResult,
        payload_hash: payloadHash,
        status: 'completed'
      });
    } catch (_) {}
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${outputResult}\n</tool_output>`,
      consoleOutput: `\n[Sandbox output executed: ${cmd}]`
    };
  }

  const writeResult = parseWriteFile(text);
  if (writeResult) {
    const filePath = writeResult.filePath;
    const content = writeResult.content;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'write_file', filePath });
    
    if (!sandbox.isPathWriteAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Write blocked (not allowed): ${filePath}]`
      };
    }

    const fileExists = fs.existsSync(absPath);
    const original = fileExists ? fs.readFileSync(absPath, 'utf-8') : null;
    
    if (original !== null && original.trim() === content.trim()) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nNo changes detected. The proposed content for ${filePath} matches the existing content.\n</tool_output>`,
        consoleOutput: `\n[No changes detected: ${filePath}]`
      };
    }
    
    state.lastWrittenFile = {
      filePath,
      original,
      content
    };
    
    const lineCount = content.split('\n').length;
    const actionVerb: 'write' | 'create' | 'modify' = fileExists ? 'modify' : 'create';

    let userConfirmed = false;
    while (true) {
      const choice = await interactiveConfirmWrite(filePath, lineCount, actionVerb);
      if (choice === 'y') {
        userConfirmed = true;
        break;
      } else if (choice === 'n') {
        userConfirmed = false;
        break;
      } else if (choice === 'p') {
        if (fileExists && original !== null) {
          renderSideBySideDiff(original, content, getLanguageFromFilename(filePath), filePath);
        } else {
          renderNewFileBlock(content, getLanguageFromFilename(filePath), filePath);
        }
      }
    }
    
    if (!userConfirmed) {
      printToolResult('skipped', `Skipped ${filePath}`);
      return {
        toolRun: false,
        nextPrompt: '',
        consoleOutput: `\n[Write rejected by user: ${filePath}]`
      };
    }
    
    process.stdout.write(`  ${themeOrange('⠋')} ${themeAccent('write')} ${filePath} ...`);
    try {
      indexer.backupBeforeWrite(absPath);
      
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, content, 'utf-8');
      
      // Clear sandbox loop history since file modification changes workspace state
      sandbox.clearLoopHistory();
      
      // Record written file for sandbox write-before-run enforcement
      sandbox.recordWrittenFile(absPath);
      
      // Re-index
      try {
        const stat = fs.statSync(absPath);
        indexer['processFileOnStartup'](absPath, stat);
        indexer['currentRepoMap'] = buildRepoMap(indexer['db']);
      } catch (e) {}
      
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('success', `Wrote ${filePath} (${lineCount} lines)`);
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('../pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer['db']);
        const payloadHash = crypto.createHash('sha256').update(content).digest('hex');
        auditStore.logAction({
          service: 'file_write',
          operation: 'write_file',
          target: absPath,
          payload_summary: `Wrote ${lineCount} lines to ${filePath}`,
          payload_hash: payloadHash,
          status: 'completed'
        });
      } catch (_) {}
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully written and indexed at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File written: ${filePath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Wrote ${filePath} — failed: ${err.message}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError writing file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File write failed: ${filePath}]`
      };
    }
  }

  const readPath = parseReadFile(text);
  if (readPath !== null) {
    const filePath = readPath;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'read_file', filePath });
    
    if (!sandbox.isPathAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Read blocked (not allowed): ${filePath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('read')} ${filePath} ...`);
    
    let content = '';
    let success = false;
    try {
      if (fs.existsSync(absPath)) {
        const stat = fs.statSync(absPath);
        if (stat.isDirectory()) {
          content = `Error: ${filePath} is a directory. Use run_command with shell commands like 'ls' or 'find' to inspect its contents.`;
        } else {
          content = fs.readFileSync(absPath, 'utf-8');
          success = true;
        }
      } else {
        content = `Error: File not found at ${filePath}`;
      }
    } catch (err: any) {
      content = `Error: ${err.message}`;
    }
    
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    if (success) {
      printToolResult('success', `Read ${filePath} (${content.split('\n').length} lines)`);
    } else {
      printToolResult('failure', `Read ${filePath} (failed)`);
    }
    
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nFile content of ${filePath}:\n${content}\n</tool_output>`,
      consoleOutput: `\n[File read: ${filePath}]`
    };
  }

  const searchQuery = parseSearchCode(text);
  if (searchQuery !== null) {
    const query = searchQuery.trim();
    if (isGui) guiEmit({ type: 'tool-call', tool: 'search_code', query });
    if (!query) {
      printToolResult('failure', `Searched "${query}" (blocked: empty query)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: Search query cannot be empty. Please provide specific keywords to search the codebase.\n</tool_output>`,
        consoleOutput: `\n[Search blocked: empty query]`
      };
    }
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('search')} index for "${query}" ...`);
    
    let results: ChunkRecord[] = [];
    let isHybrid = false;
    try {
      const { executeHybridSearch } = await import('../pro/search/index.js');
      results = await executeHybridSearch(indexer['db'], query);
      isHybrid = true;
    } catch (e) {
      results = indexer.search(query);
    }
    
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    printToolResult('success', `${isHybrid ? 'Hybrid searched' : 'Searched'} "${query}" (${results.length} results)`);
    
    const formatted = results.slice(0, 5).map(r => 
      `- ${r.relpath} (line ${r.start_line}-${r.end_line}, type ${r.chunk_type}):\n${r.content}`
    ).join('\n\n');
    
    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nSearch results for "${query}":\n${formatted || 'No matches found'}\n</tool_output>`,
      consoleOutput: `\n[Search executed: "${query}"]`
    };
  }

  const webSearchQuery = parseWebSearch(text);
  if (webSearchQuery !== null) {
    const query = webSearchQuery.trim();
    if (isGui) guiEmit({ type: 'tool-call', tool: 'web_search', query });
    if (!query) {
      printToolResult('failure', `Web searched "${query}" (blocked: empty query)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError: Search query cannot be empty.\n</tool_output>`,
        consoleOutput: `\n[Web search blocked: empty query]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('web_search')} query "${query}" ...`);
    
    let results: any[] = [];
    try {
      const { executeWebSearch } = await import('../pro/connect/integrations/search.js');
      results = await executeWebSearch(query);
    } catch (e: any) {
      results = [];
    }

    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    printToolResult('success', `Web searched "${query}" (${results.length} results)`);

    const formatted = results.map(r => 
      `- ${r.title} (${r.url}):\n  ${r.snippet}`
    ).join('\n\n');

    try {
      const crypto = await import('crypto');
      const { AuditLogStore } = await import('../pro/audit/index.js');
      const auditStore = new AuditLogStore(indexer['db']);
      const payloadHash = crypto.createHash('sha256').update(query).digest('hex');
      auditStore.logAction({
        service: 'web-search',
        operation: 'search',
        target: query,
        payload_summary: `Found ${results.length} snippets`,
        payload_hash: payloadHash,
        status: 'completed'
      });
    } catch (_) {}

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\nWeb search results for "${query}":\n${formatted || 'No results found'}\n</tool_output>`,
      consoleOutput: `\n[Web search executed: "${query}"]`
    };
  }

  const patchResult = parsePatchFile(text);
  if (patchResult) {
    const { filePath, search, replace } = patchResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'patch_file', filePath, search, replace });

    if (!sandbox.isPathWriteAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Patch blocked (not allowed): ${filePath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('patch')} ${filePath} ...`);

    try {
      if (!fs.existsSync(absPath)) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        printToolResult('failure', `Patched ${filePath} (failed: file not found)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: "Search string not found in file. Verify the text matches exactly including whitespace and indentation.",
          code: "PATCH_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch failed: File not found: ${filePath}]`
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      const index = content.indexOf(search);
      if (index === -1) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        printToolResult('failure', `Patched ${filePath} (failed: search string not found)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: "Search string not found in file. Verify the text matches exactly including whitespace and indentation.",
          code: "PATCH_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch failed: Search string not found in ${filePath}]`
        };
      }

      indexer.backupBeforeWrite(absPath);

      const updated = content.slice(0, index) + replace + content.slice(index + search.length);
      fs.writeFileSync(absPath, updated, 'utf-8');

      sandbox.clearLoopHistory();
      sandbox.recordWrittenFile(absPath);

      try {
        const stat = fs.statSync(absPath);
        indexer['processFileOnStartup'](absPath, stat);
        indexer['currentRepoMap'] = buildRepoMap(indexer['db']);
      } catch (e) {}

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('success', `Patched ${filePath}`);
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('../pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer['db']);
        const payloadHash = crypto.createHash('sha256').update(updated).digest('hex');
        auditStore.logAction({
          service: 'file_patch',
          operation: 'patch_file',
          target: absPath,
          payload_summary: `Patched ${filePath}`,
          payload_hash: payloadHash,
          status: 'completed'
        });
      } catch (_) {}
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully patched at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File patched: ${filePath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Patched ${filePath} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError patching file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File patch failed: ${filePath}]`
      };
    }
  }

  const patchBlocksResult = parsePatchFileBlocks(text);
  if (patchBlocksResult) {
    const { filePath, diff } = patchBlocksResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], filePath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'patch_file_blocks', filePath });

    if (!sandbox.isPathWriteAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Patch blocks blocked (not allowed): ${filePath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('patch_blocks')} ${filePath} ...`);

    try {
      if (!fs.existsSync(absPath)) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        printToolResult('failure', `Patched ${filePath} (failed: file not found)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: `File not found at ${filePath}`,
          code: "PATCH_FILE_NOT_FOUND",
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch blocks failed: File not found: ${filePath}]`
        };
      }

      const content = fs.readFileSync(absPath, 'utf-8');
      
      let updated: string;
      try {
        updated = applySearchReplaceBlocks(content, diff);
      } catch (err: any) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        printToolResult('failure', `Patched ${filePath} (failed: applying blocks failed)`);
        const relPath = path.relative(sandbox['workspaceRoot'], absPath);
        const errObj = {
          error: err.message || String(err),
          code: err.code || "PATCH_BLOCK_FAILED",
          blockIndex: err.blockIndex,
          filePath: relPath
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Patch blocks failed: ${err.message}]`
        };
      }

      indexer.backupBeforeWrite(absPath);

      fs.writeFileSync(absPath, updated, 'utf-8');

      sandbox.clearLoopHistory();
      sandbox.recordWrittenFile(absPath);

      try {
        const stat = fs.statSync(absPath);
        indexer['processFileOnStartup'](absPath, stat);
        indexer['currentRepoMap'] = buildRepoMap(indexer['db']);
      } catch (e) {}

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('success', `Patched ${filePath}`);
      try {
        const crypto = await import('crypto');
        const { AuditLogStore } = await import('../pro/audit/index.js');
        const auditStore = new AuditLogStore(indexer['db']);
        const payloadHash = crypto.createHash('sha256').update(updated).digest('hex');
        auditStore.logAction({
          service: 'file_patch',
          operation: 'patch_file_blocks',
          target: absPath,
          payload_summary: `Patched blocks in ${filePath}`,
          payload_hash: payloadHash,
          status: 'completed'
        });
      } catch (_) {}
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nFile successfully patched using blocks at ${filePath}\n</tool_output>`,
        consoleOutput: `\n[File patched with blocks: ${filePath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Patched ${filePath} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError patching file: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[File patch blocks failed: ${filePath}]`
      };
    }
  }

  const listDirResult = parseListDir(text);
  if (listDirResult) {
    const { pathVal, recursive } = listDirResult;
    const absPath = path.resolve(sandbox['workspaceRoot'], pathVal);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'list_dir', pathVal, recursive });

    if (!sandbox.isPathAllowed(absPath)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absPath} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absPath
        })}\n</tool_output>`,
        consoleOutput: `\n[List dir blocked (not allowed): ${pathVal}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('list_dir')} ${pathVal} ...`);

    try {
      if (!fs.existsSync(absPath) || !fs.statSync(absPath).isDirectory()) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        printToolResult('failure', `Listed directory ${pathVal} (failed: not found)`);
        const errObj = {
          error: `Directory not found at ${pathVal}`,
          code: "DIRECTORY_NOT_FOUND",
          path: pathVal
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[List dir failed: Directory not found: ${pathVal}]`
        };
      }

      const result = listDirectory(absPath, sandbox['workspaceRoot'], recursive);

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('success', `Listed directory ${pathVal}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Directory listed: ${pathVal}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Listed directory ${pathVal} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError listing directory: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Directory list failed: ${pathVal}]`
      };
    }
  }

  if (parseGitStatus(text)) {
    if (isGui) guiEmit({ type: 'tool-call', tool: 'git_status' });
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('git_status')} ...`);

    try {
      let isGit = false;
      try {
        execSync('git rev-parse --is-inside-work-tree', { cwd: sandbox['workspaceRoot'], stdio: 'ignore' });
        isGit = true;
      } catch (e) {}

      if (!isGit) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        printToolResult('failure', `Ran git status (failed: not a git repo)`);
        const errObj = {
          error: "Not a git repository",
          code: "NOT_GIT_REPO"
        };
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify(errObj)}\n</tool_output>`,
          consoleOutput: `\n[Git status failed: Not a git repository]`
        };
      }

      const branch = execSync('git branch --show-current', { cwd: sandbox['workspaceRoot'] }).toString().trim();
      const statusText = execSync('git status --porcelain', { cwd: sandbox['workspaceRoot'] }).toString().trim();

      const lines = statusText ? statusText.split('\n') : [];
      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];

      for (const line of lines) {
        const x = line[0];
        const y = line[1];
        const file = line.slice(3).replace(/^["']|["']$/g, '');

        if (x === '?' && y === '?') {
          untracked.push(file);
        } else {
          if (x !== ' ' && x !== '?') {
            staged.push(file);
          }
          if (y !== ' ' && y !== '?') {
            unstaged.push(file);
          }
        }
      }

      let ahead = 0;
      let behind = 0;
      try {
        const revList = execSync('git rev-list --left-right --count HEAD...@{u}', { cwd: sandbox['workspaceRoot'], stdio: 'pipe' }).toString().trim();
        const parts = revList.split(/\s+/);
        if (parts.length === 2) {
          ahead = parseInt(parts[0], 10) || 0;
          behind = parseInt(parts[1], 10) || 0;
        }
      } catch (e) {}

      const result = {
        branch,
        staged,
        unstaged,
        untracked,
        ahead,
        behind
      };

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('success', `Ran git status`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Git status completed]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Ran git status (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError running git status: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Git status failed: ${err.message}]`
      };
    }
  }

  const diagResult = parseDiagnosticsTag(text);
  if (diagResult !== null) {
    let commandToRun = diagResult.command;
    const workspaceRoot = sandbox['workspaceRoot'];

    if (!commandToRun) {
      if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
        let hasLintScript = false;
        try {
          const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
          if (pkg.scripts && pkg.scripts.lint) {
            hasLintScript = true;
          }
        } catch (e) {}
        commandToRun = hasLintScript ? 'npm run lint' : 'npm run build';
      } else if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
        commandToRun = 'cargo check';
      } else if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
        commandToRun = 'go build ./...';
      } else if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) || fs.existsSync(path.join(workspaceRoot, 'setup.py'))) {
        commandToRun = 'python -m py_compile';
      }
    }

    if (!commandToRun) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          passed: true,
          errors: [],
          warnings: [],
          raw: "No standard project configuration (package.json, Cargo.toml, go.mod, pyproject.toml, setup.py) detected to run diagnostics."
        }, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Diagnostics skipped: No configuration]`
      };
    }

    if (isGui) guiEmit({ type: 'tool-call', tool: 'diagnostics', command: commandToRun });
    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('diagnostics')} (running "${commandToRun}") ...`);

    try {
      const rawOutput = await sandbox.runCommand(commandToRun);
      
      const parsed = parseDiagnostics(rawOutput);
      const result = {
        passed: parsed.passed,
        errors: parsed.errors,
        warnings: parsed.warnings,
        raw: rawOutput
      };

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('success', `Ran diagnostics: ${commandToRun}`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify(result, null, 2)}\n</tool_output>`,
        consoleOutput: `\n[Diagnostics completed: "${commandToRun}"]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Ran diagnostics: ${commandToRun} (failed)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\nError running diagnostics: ${err.message}\n</tool_output>`,
        consoleOutput: `\n[Diagnostics failed]`
      };
    }
  }

  const moveResult = parseMoveFile(text);
  if (moveResult !== null) {
    const { sourcePath, destinationPath } = moveResult;
    const absSource = path.resolve(sandbox['workspaceRoot'], sourcePath);
    const absDest = path.resolve(sandbox['workspaceRoot'], destinationPath);
    if (isGui) guiEmit({ type: 'tool-call', tool: 'move_file', sourcePath, destinationPath });

    if (!sandbox.isPathWriteAllowed(absSource)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absSource} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absSource
        })}\n</tool_output>`,
        consoleOutput: `\n[Move blocked (source not allowed): ${sourcePath}]`
      };
    }

    if (!sandbox.isPathWriteAllowed(absDest)) {
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Path is outside the workspace. You must request permission using the <question> tool tag: <question options="Allow read-write, Allow read-only, Deny">I need access to ${absDest} to complete this task. Grant access?</question>`,
          code: "PATH_NOT_ALLOWED",
          path: absDest
        })}\n</tool_output>`,
        consoleOutput: `\n[Move blocked (destination not allowed): ${destinationPath}]`
      };
    }

    if (!fs.existsSync(absSource)) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Moved ${sourcePath} (failed: source not found)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Source file not found at ${sourcePath}`,
          code: "MOVE_SOURCE_NOT_FOUND",
          sourcePath
        })}\n</tool_output>`,
        consoleOutput: `\n[Move failed: Source not found: ${sourcePath}]`
      };
    }

    if (fs.existsSync(absDest)) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Moved ${sourcePath} (failed: destination exists)`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Destination path already exists at ${destinationPath}. Move aborted to prevent overwrite.`,
          code: "MOVE_DESTINATION_EXISTS",
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[Move failed: Destination exists: ${destinationPath}]`
      };
    }

    process.stdout.write(`\n  ${themeOrange('⠋')} ${themeAccent('move')} ${sourcePath} to ${destinationPath} ...`);

    try {
      fs.mkdirSync(path.dirname(absDest), { recursive: true });
      fs.renameSync(absSource, absDest);

      indexer.renameFile(absSource, absDest);
      sandbox.recordWrittenFile(absDest);
      sandbox.clearLoopHistory();

      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('success', `Moved ${sourcePath} to ${destinationPath}`);
      
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          success: true,
          message: `File successfully moved/renamed from ${sourcePath} to ${destinationPath}`,
          sourcePath,
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[File moved: ${sourcePath} -> ${destinationPath}]`
      };
    } catch (err: any) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      printToolResult('failure', `Moved ${sourcePath} to ${destinationPath} (failed: ${err.message})`);
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          error: `Failed to move/rename file: ${err.message}`,
          code: "MOVE_FAILED",
          sourcePath,
          destinationPath
        })}\n</tool_output>`,
        consoleOutput: `\n[File move failed: ${sourcePath} -> ${destinationPath}]`
      };
    }
  }

  const questionResult = parseQuestion(text);
  if (questionResult !== null) {
    const { question, options } = questionResult;
    if (isGui) guiEmit({ type: 'tool-call', tool: 'question', question, options });
    
    let chosenIdx = 0;
    if (state.isNonInteractive || typeof process.stdin.setRawMode !== 'function') {
      console.log(`\n${themePrimary.bold(question)}`);
      options.forEach((opt, idx) => console.log(`  ${idx + 1}) ${opt}`));
      const answer = await new Promise<string>((resolve) => {
        rl.question(`Select an option (1-${options.length}): `, (input) => {
          resolve(input.trim());
        });
      });
      const num = parseInt(answer, 10);
      chosenIdx = (!isNaN(num) && num >= 1 && num <= options.length) ? num - 1 : 0;
    } else {
      chosenIdx = await interactiveSelect(question, options);
    }

    const choice = options[chosenIdx];
    
    // Extract path from question
    let extractedPath: string | null = null;
    const regex = new RegExp("(?:^|\\s|['\"`])(\\/[^'\"\\s]+|~\\/[^'\"\\s]+|~)");
    const pathMatch = question.match(regex);
    if (pathMatch) {
      let p = pathMatch[1];
      while (p && /[?.!,;]$/.test(p)) {
        p = p.slice(0, -1);
      }
      extractedPath = p;
    }

    if (choice === 'Allow read-write') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!state.activeAllowedPaths.some(ap => ap.path === absPath && ap.mode === 'rw')) {
          state.activeAllowedPaths = state.activeAllowedPaths.filter(ap => ap.path !== absPath);
          state.activeAllowedPaths.push({ path: absPath, mode: 'rw' });
        }
        sandbox.updateAllowedPaths(state.activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'rw',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (rw): ${absPath}]`
        };
      }
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          granted: true,
          message: 'Access granted, but no path could be extracted from the question.'
        })}\n</tool_output>`,
        consoleOutput: `\n[Permission granted: no path extracted]`
      };
    }

    if (choice === 'Allow read-only') {
      if (extractedPath) {
        let resolvedPath = extractedPath;
        if (resolvedPath.startsWith('~/') || resolvedPath === '~') {
          resolvedPath = path.join(os.homedir(), resolvedPath.slice(1));
        }
        const absPath = path.resolve(resolvedPath);
        if (!state.activeAllowedPaths.some(ap => ap.path === absPath)) {
          state.activeAllowedPaths.push({ path: absPath, mode: 'ro' });
        }
        sandbox.updateAllowedPaths(state.activeAllowedPaths);
        return {
          toolRun: true,
          nextPrompt: `<tool_output>\n${JSON.stringify({
            granted: true,
            path: absPath,
            mode: 'ro',
            message: 'Access granted. Mount added dynamically.'
          })}\n</tool_output>`,
          consoleOutput: `\n[Permission granted (ro): ${absPath}]`
        };
      }
      return {
        toolRun: true,
        nextPrompt: `<tool_output>\n${JSON.stringify({
          granted: true,
          message: 'Access granted, but no path could be extracted from the question.'
        })}\n</tool_output>`,
        consoleOutput: `\n[Permission granted: no path extracted]`
      };
    }

    return {
      toolRun: true,
      nextPrompt: `<tool_output>\n${JSON.stringify({
        granted: false,
        path: extractedPath ? path.resolve(extractedPath.startsWith('~/') || extractedPath === '~' ? (os.homedir() + extractedPath.slice(1)) : extractedPath) : undefined
      })}\n</tool_output>`,
      consoleOutput: `\n[Permission denied]`
    };
  }

  return { toolRun: false, nextPrompt: '', consoleOutput: '' };
}
