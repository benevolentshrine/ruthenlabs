export const ARCHIVE = {
    '/cost': {
        description: '[archived] Token usage (no billing with local Ollama)',
        handler(args, state) {
            const { input, output } = state.tokenUsage;
            return [
                `Token usage: input=${input}, output=${output}`,
                `(No cost tracking for local Ollama.)`,
            ].join('\n');
        },
    },

    '/think': {
        description: '[archived] Toggle extended thinking (not supported by Ollama)',
        handler() {
            return 'Extended thinking is not available with Ollama models.';
        },
    },

    '/effort': {
        description: '[archived] Set effort level (not applicable to Ollama)',
        handler() {
            return 'Effort level is not a concept for local Ollama models.';
        },
    },

    '/memory': {
        description: '[archived] Show conversation memory usage',
        handler(args, state) {
            const msgSize = JSON.stringify(state.messages).length;
            const tokenEst = state._contextManager
                ? state._contextManager.getTokenCount(state.messages)
                : Math.ceil(msgSize / 4);
            return `Memory: ${state.messages.length} messages, ~${(msgSize / 1024).toFixed(1)}KB, ~${tokenEst} tokens`;
        },
    },

    '/forget': {
        description: '[archived] Remove last N messages',
        handler(args, state) {
            const n = parseInt(args) || 2;
            const removed = state.messages.splice(-n, n);
            return `Removed ${removed.length} messages.`;
        },
    },

    '/terminal-setup': {
        description: '[archived] Show terminal setup info',
        handler() {
            return [
                'Terminal setup:',
                `  TERM: ${process.env.TERM || 'unknown'}`,
                `  COLUMNS: ${process.stdout.columns || 'unknown'}`,
                `  ROWS: ${process.stdout.rows || 'unknown'}`,
                `  Color: ${process.stdout.hasColors?.() ? 'yes' : 'unknown'}`,
                `  Unicode: ${process.env.LANG?.includes('UTF') ? 'yes' : 'unknown'}`,
            ].join('\n');
        },
    },

    '/permissions': {
        description: '[archived] Show permission mode',
        handler(args, state) {
            return `Permission mode: ${state._permissionMode || 'default'}`;
        },
    },

    '/extra-usage': {
        description: '[archived] Show detailed usage stats',
        handler(args, state) {
            const { PromptCache } = require('../../core/cache.mjs');
            const pc = new PromptCache();
            const cacheStats = pc.getStats();
            return [
                `Tokens: in=${state.tokenUsage.input}, out=${state.tokenUsage.output}`,
                `Cache: hits=${cacheStats.cacheHits}, misses=${cacheStats.cacheMisses}, rate=${cacheStats.hitRate}`,
            ].join('\n');
        },
    },
};
