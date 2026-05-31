/**
 * Read Tool — routes to UNIT-01 INDEXER daemon via UDS.
 *
 * Sends JSON-RPC "read" method to the indexer socket.
 * All file I/O is handled by the background indexer process.
 */
import { callIndexer, isSandboxViolation } from '../utils/udsClient.mjs';

const readFiles = new Set();

export function hasBeenRead(filePath) {
    return readFiles.has(filePath);
}

export function markRead(filePath) {
    readFiles.add(filePath);
}

export const ReadTool = {
    name: 'Read',
    description: 'Read a file from the filesystem via UNIT-01 indexer.',
    inputSchema: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            offset: { type: 'number', description: 'Line number to start reading from (0-based)' },
            limit: { type: 'number', description: 'Number of lines to read (default 2000)' },
            pages: { type: 'string', description: 'Page range for PDF files (e.g. "1-5")' },
        },
        required: ['file_path'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.file_path) errors.push('file_path is required');
        return errors;
    },
    async call(input) {
        try {
            const response = await callIndexer('read', { path: input.file_path });

            const violation = isSandboxViolation(response);
            if (violation) {
                return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}`;
            }

            if (response.error) {
                return `Error: ${response.error.message || JSON.stringify(response.error)}`;
            }

            const content = response.result?.content;
            if (content === undefined || content === null) {
                return 'Error: File not found or empty response from indexer';
            }

            if (content === '') {
                return '[File exists but is empty]';
            }

            readFiles.add(input.file_path);

            const lines = content.split('\n');
            const start = input.offset || 0;
            const limit = input.limit || 2000;
            const end = Math.min(start + limit, lines.length);

            const output = lines
                .slice(start, end)
                .map((l, i) => `${start + i + 1}\t${l}`)
                .join('\n');

            if (end < lines.length) {
                return output + `\n\n[File has ${lines.length} lines total. Showing lines ${start + 1}-${end}. Use offset/limit for more.]`;
            }

            return output;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
