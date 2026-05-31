/**
 * Bash Tool — routes to UNIT-01 SANDBOX daemon via UDS.
 *
 * Sends JSON-RPC "cage_execute" method to the sandbox socket.
 * All command execution is sandboxed by the background daemon
 * (Landlock + Seccomp on Linux, Seatbelt on macOS).
 *
 * Sandbox violations (codes 1000-1003) are returned as formatted
 * messages instead of crashing the process.
 */
import { callSandbox, isSandboxViolation } from '../utils/udsClient.mjs';

export const BashTool = {
    name: 'Bash',
    description: 'Execute a command via UNIT-01 sandbox daemon.',
    inputSchema: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'The command to execute' },
            timeout: { type: 'number', description: 'Timeout in ms (max 600000)', default: 120000 },
            description: { type: 'string', description: 'Description of what this command does' },
            run_in_background: { type: 'boolean', description: 'Run in background', default: false },
        },
        required: ['command'],
    },
    validateInput(input) {
        const errors = [];
        if (!input.command) errors.push('command is required');
        return errors;
    },
    async call(input) {
        const timeout = Math.min(input.timeout || 120000, 600000);

        if (input.run_in_background) {
            try {
                const response = await callSandbox('cage_execute', {
                    cmd: input.command,
                    timeout,
                });
                const violation = isSandboxViolation(response);
                if (violation) {
                    return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}`;
                }
                const verdict = response.result?.verdict || '';
                return `Background execution dispatched.\n${verdict}`;
            } catch (e) {
                return `Error: ${e.message}`;
            }
        }

        try {
            const response = await callSandbox('cage_execute', {
                cmd: input.command,
                timeout,
            });

            const violation = isSandboxViolation(response);
            if (violation) {
                return `⚠️ SANDBOX VIOLATION [${violation.code}]: ${violation.message}\n${violation.verdict}`;
            }

            if (response.error) {
                const verdict = response.result?.verdict || '';
                return `Error: ${response.error.message || JSON.stringify(response.error)}\n${verdict}`;
            }

            const verdict = response.result?.verdict || '';
            if (!verdict || verdict.trim() === '') {
                return '(no output)';
            }

            const lines = verdict.split('\n');
            const stdoutLines = [];
            const stderrLines = [];
            let current = stdoutLines;

            for (const line of lines) {
                if (line === 'STDERR:') {
                    current = stderrLines;
                    continue;
                }
                if (line === 'STDOUT:') {
                    current = stdoutLines;
                    continue;
                }
                current.push(line);
            }

            const stdout = stdoutLines.join('\n').trim();
            const stderr = stderrLines.join('\n').trim();

            const output = stdout + (stderr ? '\n' + stderr : '');
            return output || '(no output)';
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
