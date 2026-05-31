/**
 * Glob Tool — routes to UNIT-01 INDEXER daemon via UDS.
 *
 * Sends JSON-RPC "glob" method to the indexer socket.
 * File matching is handled by the background indexer process.
 */
import { callIndexer, isSandboxViolation } from '../utils/udsClient.mjs';

export const GlobTool = {
    name: 'Glob',
    description: 'Find files matching a glob pattern via UNIT-01 indexer.',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.js")' },
            path: { type: 'string', description: 'Directory to search in' },
        },
        required: ['pattern'],
    },
    validateInput(input) { return input.pattern ? [] : ['pattern required']; },
    async call(input) {
        try {
            const response = await callIndexer('glob', {
                pattern: input.pattern,
                base: input.path || '.',
            });

            const violation = isSandboxViolation(response);
            if (violation) {
                return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}`;
            }

            if (response.error) {
                return `Error: ${response.error.message || JSON.stringify(response.error)}`;
            }

            const files = response.result?.files;
            if (!files || files.length === 0) {
                return 'No matches found.';
            }

            return files.join('\n');
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
