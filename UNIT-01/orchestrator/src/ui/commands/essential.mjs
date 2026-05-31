import { SessionManager } from '../../core/session.mjs';
import { CheckpointManager } from '../../core/checkpoints.mjs';
import { readEnv } from '../../config/env.mjs';

const checkpoints = new CheckpointManager();
let sessionManager = null;

function getSession() {
    if (!sessionManager) sessionManager = new SessionManager();
    return sessionManager;
}

export const ESSENTIAL = {
    '/help': {
        description: 'Show available commands',
        handler(args, state, allCommands) {
            const lines = ['', 'Available commands:'];
            for (const [name, cmd] of Object.entries(allCommands)) {
                lines.push(`  ${name.padEnd(20)} ${cmd.description}`);
            }
            lines.push('');
            return lines.join('\n');
        },
    },

    '/clear': {
        description: 'Clear conversation history',
        handler(args, state) {
            state.messages.length = 0;
            state.turnCount = 0;
            return 'Conversation cleared.';
        },
    },

    '/compact': {
        description: 'Manually compact conversation context',
        handler(args, state) {
            const before = state.messages.length;
            const beforeTokens = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : 0;

            if (state._contextManager) {
                state.messages = state._contextManager.compact(state.messages);
            } else {
                if (state.messages.length > 10) {
                    state.messages = state.messages.slice(-8);
                }
            }

            const afterTokens = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : 0;

            return `Compacted: ${before} -> ${state.messages.length} messages` +
                (beforeTokens ? ` (~${beforeTokens} -> ~${afterTokens} tokens)` : '');
        },
    },

    '/model': {
        description: 'Show or switch model',
        handler(args, state) {
            if (args) {
                state.model = args;
                return `Model switched to: ${args}`;
            }
            return `Current model: ${state.model || 'default'}`;
        },
    },

    '/models': {
        description: 'List models available in Ollama',
        async handler() {
            const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
            try {
                const res = await fetch(`${host}/api/tags`);
                if (!res.ok) return `Ollama error: ${res.status}`;
                const data = await res.json();
                const models = data.models || [];
                if (models.length === 0) return 'No models found in Ollama. Run: ollama pull <model>';
                return `Ollama models:\n${models.map(m => `  ${m.name} (${(m.size / 1e9).toFixed(1)}GB)`).join('\n')}`;
            } catch {
                return 'Cannot reach Ollama. Is ollama serve running?';
            }
        },
    },

    '/fast': {
        description: 'Toggle fast mode (stores alternate model)',
        handler(args, state) {
            if (!state._fastModel) {
                state._fastModel = args || 'Toggle sets a fast model. Use: /fast <model>';
                return state._fastModel;
            }
            const current = state.model;
            state.model = state._fastModel;
            state._fastModel = current;
            return `Fast mode — switched to ${state.model}`;
        },
    },

    '/tools': {
        description: 'List available tools',
        handler(args, state) {
            const tools = state.tools?.list?.() || [];
            if (tools.length === 0) return 'No tools registered.';
            const lines = tools.map(t => `  ${t.name.padEnd(20)} ${(t.description || '').slice(0, 55)}`);
            return `Tools (${tools.length}):\n${lines.join('\n')}`;
        },
    },

    '/version': {
        description: 'Show version info',
        handler() {
            return 'UNIT-01 — Orchestrator';
        },
    },

    '/doctor': {
        description: 'Check system health and configuration',
        handler(args, state) {
            const checks = [];
            checks.push(`Node.js: ${process.version}`);
            checks.push(`Model: ${state.model || '(none set)'}`);
            checks.push(`Tools: ${state.tools?.list?.()?.length || 0}`);
            checks.push(`Messages: ${state.messages.length}`);
            checks.push(`CWD: ${process.cwd()}`);
            checks.push(`Platform: ${process.platform}`);
            const mcpCount = state._mcpClients?.length || 0;
            checks.push(`MCP servers: ${mcpCount}`);
            return `System check:\n${checks.map(c => `  ${c}`).join('\n')}`;
        },
    },

    '/status': {
        description: 'Show session status',
        handler(args, state) {
            const session = getSession();
            const info = session.info();
            return [
                `Session: ${info.id}`,
                `Project: ${info.projectDir}`,
                `Started: ${info.startedAt}`,
                `Model: ${state.model}`,
                `Turns: ${state.turnCount}`,
                `Messages: ${state.messages.length}`,
            ].join('\n');
        },
    },

    '/config': {
        description: 'Show current configuration',
        handler(args, state) {
            const env = readEnv();
            const lines = ['Configuration:'];
            for (const [key, val] of Object.entries(env)) {
                if (key.includes('KEY') || key.includes('TOKEN')) continue;
                lines.push(`  ${key}: ${val}`);
            }
            return lines.join('\n');
        },
    },

    '/plan': {
        description: 'Enter plan mode (read-only)',
        handler(args, state) {
            state._planMode = !state._planMode;
            return `Plan mode: ${state._planMode ? 'ON (read-only)' : 'OFF'}`;
        },
    },

    '/undo': {
        description: 'Undo last file edit (restore checkpoint)',
        handler() {
            const result = checkpoints.undo();
            if (!result) return 'No checkpoints to undo.';
            if (result.restored) return `Restored: ${result.filePath}`;
            return `Undo failed: ${result.error || 'unknown error'}`;
        },
    },

    '/diff': {
        description: 'Show git diff',
        handler() {
            try {
                const { execSync } = require('child_process');
                return execSync('git diff --stat 2>/dev/null || echo "Not in a git repo"', { encoding: 'utf-8' });
            } catch {
                return 'Unable to show diff.';
            }
        },
    },

    '/commit': {
        description: 'Create a git commit with AI message',
        handler(args) {
            try {
                const { execFileSync } = require('child_process');
                const msg = args || 'Update from UNIT-01';
                execFileSync('git', ['add', '-A'], { encoding: 'utf-8' });
                execFileSync('git', ['commit', '-m', msg], { encoding: 'utf-8' });
                return `Committed: ${msg}`;
            } catch (err) {
                return `Commit failed: ${err.message}`;
            }
        },
    },

    '/quit': {
        description: 'Exit the REPL',
        handler() { return 'EXIT'; },
    },

    '/exit': {
        description: 'Exit the REPL',
        handler() { return 'EXIT'; },
    },
};
