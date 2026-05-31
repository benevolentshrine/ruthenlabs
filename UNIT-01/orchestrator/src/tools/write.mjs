/**
 * Write Tool — routes to UNIT-01 INDEXER daemon via UDS.
 *
 * Sends JSON-RPC "write" method to the indexer socket.
 * The indexer handles parent directory creation and shadow backups.
 */
import { callIndexer, isSandboxViolation } from '../utils/udsClient.mjs';
import { hasBeenRead, markRead } from './read.mjs';

export const WriteTool = {
    name: 'Write',
    description: 'Write content to a file via UNIT-01 indexer. Creates parent dirs if needed.',
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            content: { type: 'string', description: 'The content to write' },
        },
        required: ['file_path', 'content'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.file_path) errors.push('file_path required');
        return errors;
    },
    async call(input) {
        if (!hasBeenRead(input.file_path)) {
            return `Error: File ${input.file_path} already exists. You must Read it first before overwriting.`;
        }

        try {
            const response = await callIndexer('write', {
                path: input.file_path,
                content: input.content,
            });

            const violation = isSandboxViolation(response);
            if (violation) {
                return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}`;
            }

            if (response.error) {
                return `Error: ${response.error.message || JSON.stringify(response.error)}`;
            }

            const status = response.result?.status || `File written: ${input.file_path}`;
            markRead(input.file_path);
            return status;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
