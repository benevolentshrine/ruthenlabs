/**
 * Grep Tool — routes to UNIT-01 INDEXER daemon via UDS.
 *
 * Sends JSON-RPC "search" method to the indexer socket.
 * Content searching is handled by the background indexer process.
 */
import { callIndexer, isSandboxViolation } from '../utils/udsClient.mjs';

export const GrepTool = {
    name: 'Grep',
    description: 'Search file contents with regex via UNIT-01 indexer.',
    inputSchema: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Regex pattern to search for' },
            path: { type: 'string', description: 'File or directory to search in' },
            '-i': { type: 'boolean', description: 'Case insensitive' },
            '-n': { type: 'boolean', description: 'Show line numbers (default true)' },
            output_mode: {
                type: 'string',
                enum: ['content', 'files_with_matches', 'count'],
                description: 'Output mode (default: files_with_matches)',
            },
            glob: { type: 'string', description: 'Glob pattern to filter files' },
            type: { type: 'string', description: 'File type filter (e.g. js, py)' },
            head_limit: { type: 'number', description: 'Max results (default 250)' },
        },
        required: ['pattern'],
    },
    validateInput(input) { return input.pattern ? [] : ['pattern required']; },
    async call(input) {
        try {
            const response = await callIndexer('search', {
                query: input.pattern,
                limit: input.head_limit ?? 250,
            });

            const violation = isSandboxViolation(response);
            if (violation) {
                return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}`;
            }

            if (response.error) {
                return `Error: ${response.error.message || JSON.stringify(response.error)}`;
            }

            const results = response.result;
            if (!results || (Array.isArray(results) && results.length === 0)) {
                return 'No matches found.';
            }

            const mode = input.output_mode || 'files_with_matches';

            if (mode === 'count') {
                const count = Array.isArray(results) ? results.length : 0;
                return `${count} matches found`;
            }

            if (mode === 'files_with_matches') {
                const files = Array.isArray(results)
                    ? results.map(r => r.path || r.relative_path || r)
                    : [];
                return [...new Set(files)].join('\n');
            }

            if (mode === 'content') {
                const lines = Array.isArray(results)
                    ? results.map((r, i) => `${r.path}:${r.line || i + 1}:${r.text || ''}`)
                    : [];
                return lines.join('\n');
            }

            return JSON.stringify(results, null, 2);
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
