/**
 * LS Tool — routes to UNIT-01 INDEXER daemon via UDS.
 *
 * Sends JSON-RPC "ls" method to the indexer socket.
 * Directory listing is handled by the background indexer process.
 */
import { callIndexer, isSandboxViolation } from '../utils/udsClient.mjs';

export const LsTool = {
    name: 'LS',
    description: 'List directory contents via UNIT-01 indexer.',
    inputSchema: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Directory path to list (default: cwd)' },
            all: { type: 'boolean', description: 'Include hidden files (default: false)' },
        },
        required: [],
    },
    validateInput() { return []; },
    async call(input) {
        try {
            const dirPath = input.path || '.';
            const response = await callIndexer('ls', { path: dirPath });

            const violation = isSandboxViolation(response);
            if (violation) {
                return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}`;
            }

            if (response.error) {
                return `Error: ${response.error.message || JSON.stringify(response.error)}`;
            }

            const entries = response.result?.entries;
            if (!entries || entries.length === 0) {
                return `${dirPath}:\nEmpty directory`;
            }

            const results = [];
            for (const entry of entries) {
                if (!input.all && entry.name.startsWith('.')) continue;

                const type = entry.type === 'dir' ? 'd' : '-';
                const size = entry.type === 'dir' ? '' : formatSize(entry.size || 0);
                const suffix = entry.type === 'dir' ? '/' : '';
                results.push(`${type} ${size.padStart(8)} ${entry.name}${suffix}`);
            }

            if (results.length === 0) return `${dirPath}:\nEmpty directory`;
            return `${dirPath}:\n${results.join('\n')}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};

function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}
