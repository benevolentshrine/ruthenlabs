export const AUXILIARY = {
    '/review': {
        description: 'Review recent changes',
        handler(args, state) {
            try {
                const { execSync } = require('child_process');
                const diff = execSync('git diff --stat HEAD~1 2>/dev/null || echo "No git history"', { encoding: 'utf-8' });
                return `Recent changes:\n${diff}`;
            } catch {
                return 'Unable to review changes (not in a git repo or no history).';
            }
        },
    },

    '/listen': {
        description: 'Toggle listening mode (voice input stub)',
        handler(args, state) {
            state._listening = !state._listening;
            return `Listening mode: ${state._listening ? 'ON (stub)' : 'OFF'}`;
        },
    },

    '/vim': {
        description: 'Toggle vim keybindings',
        handler(args, state) {
            state._vimMode = !state._vimMode;
            return `Vim mode: ${state._vimMode ? 'ON' : 'OFF'}`;
        },
    },

    '/bug': {
        description: 'Report a bug',
        handler() {
            return 'Report bugs at: https://github.com/FreePeak/kai/issues';
        },
    },

    '/pr': {
        description: 'Create a pull request (stub)',
        handler() {
            return 'PR creation requires gh CLI. Run: gh pr create --fill';
        },
    },

    '/release': {
        description: 'Create a release (stub)',
        handler() {
            return 'Release creation requires gh CLI. Run: gh release create <tag>';
        },
    },

    '/agents': {
        description: 'List custom agents',
        handler(args, state) {
            if (!state._agentLoader) return 'No agent loader initialized.';
            const agents = state._agentLoader.list();
            if (agents.length === 0) return 'No custom agents loaded.';
            return `Agents:\n${agents.map(a => `  ${a.name}: ${a.description}`).join('\n')}`;
        },
    },

    '/skills': {
        description: 'List available skills',
        handler(args, state) {
            if (!state._skillsLoader) return 'No skills loaded.';
            const skills = state._skillsLoader.list();
            if (skills.length === 0) return 'No skills loaded.';
            return `Skills:\n${skills.map(s => `  /${s.name}: ${s.description}`).join('\n')}`;
        },
    },

    '/mcp': {
        description: 'Show MCP server status',
        handler(args, state) {
            if (!state._mcpClients || state._mcpClients.length === 0) {
                return 'No MCP servers connected.';
            }
            const lines = state._mcpClients.map((c, i) =>
                `  ${i + 1}. ${c.config?.command || 'unknown'} — ${c.connected ? 'connected' : 'disconnected'}`
            );
            return `MCP servers:\n${lines.join('\n')}`;
        },
    },

    '/schedule': {
        description: 'List scheduled tasks',
        handler() {
            const { cronStore } = require('../../tools/cron-create.mjs');
            if (!cronStore || cronStore.size === 0) return 'No scheduled tasks.';
            const lines = [];
            for (const [, job] of cronStore) {
                lines.push(`  ${job.id}: ${job.name} (${job.schedule})`);
            }
            return `Scheduled:\n${lines.join('\n')}`;
        },
    },

    '/tokens': {
        description: 'Show token usage and context size',
        handler(args, state) {
            const contextTokens = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : '?';
            return [
                `Input: ${state.tokenUsage.input}, Output: ${state.tokenUsage.output}`,
                `Messages: ${state.messages.length}`,
                `Context: ~${contextTokens} tokens`,
            ].join('\n');
        },
    },

    '/init': {
        description: 'Initialize Claude Code in current directory',
        handler() {
            const fs = require('fs');
            const path = require('path');
            const claudeDir = path.join(process.cwd(), '.claude');
            fs.mkdirSync(claudeDir, { recursive: true });
            const settingsFile = path.join(claudeDir, 'settings.json');
            if (!fs.existsSync(settingsFile)) {
                fs.writeFileSync(settingsFile, JSON.stringify({ permissions: {}, hooks: {} }, null, 2));
            }
            return `Initialized .claude/ in ${process.cwd()}`;
        },
    },

    '/login': {
        description: 'Set Ollama host (e.g. http://localhost:11434)',
        handler(args) {
            if (args) {
                process.env.OLLAMA_HOST = args;
                return `Ollama host set to: ${args}`;
            }
            return `Ollama host: ${process.env.OLLAMA_HOST || 'http://localhost:11434'}`;
        },
    },

    '/logout': {
        description: 'Reset Ollama host to default',
        handler() {
            delete process.env.OLLAMA_HOST;
            return 'Ollama host reset to http://localhost:11434';
        },
    },

    '/hooks': {
        description: 'Show configured hooks',
        handler(args, state) {
            if (!state._hooks) return 'No hooks configured.';
            const hooks = state._hooks;
            const lines = [];
            for (const [event, handlers] of Object.entries(hooks)) {
                const arr = Array.isArray(handlers) ? handlers : [handlers];
                lines.push(`  ${event}: ${arr.length} handler(s)`);
            }
            return lines.length > 0 ? `Hooks:\n${lines.join('\n')}` : 'No hooks configured.';
        },
    },
};
