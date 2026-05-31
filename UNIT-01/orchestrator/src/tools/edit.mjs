/**
 * Edit Tool — routes to UNIT-01 INDEXER daemon via UDS.
 *
 * Uses the indexer "patch" method for exact string replacements.
 * Falls back to read+write logic via indexer if patch is unavailable.
 */
import { callIndexer, isSandboxViolation } from '../utils/udsClient.mjs';
import { hasBeenRead, markRead } from './read.mjs';

export const EditTool = {
    name: 'Edit',
    description: 'Performs exact string replacements in files via UNIT-01 indexer.',
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            old_string: { type: 'string', description: 'The text to replace' },
            new_string: { type: 'string', description: 'The replacement text' },
            replace_all: { type: 'boolean', description: 'Replace all occurrences', default: false },
        },
        required: ['file_path', 'old_string', 'new_string'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.file_path) errors.push('file_path required');
        if (input.old_string === undefined) errors.push('old_string required');
        if (input.old_string === input.new_string) errors.push('old_string must differ from new_string');
        return errors;
    },
    async call(input) {
        if (!hasBeenRead(input.file_path)) {
            return `Error: You must Read ${input.file_path} before editing it. Use the Read tool first.`;
        }

        try {
            const response = await callIndexer('patch', {
                path: input.file_path,
                target: input.old_string,
                replacement: input.new_string,
            });

            const violation = isSandboxViolation(response);
            if (violation) {
                return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}`;
            }

            if (response.error) {
                return `Error: ${response.error.message || JSON.stringify(response.error)}`;
            }

            const status = response.result?.status || `File updated: ${input.file_path}`;
            markRead(input.file_path);
            return status;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
