/**
 * UDS Client — JSON-RPC 2.0 over Unix Domain Sockets for UNIT-01.
 *
 * Connects to two persistent background daemons:
 *   INDEXER — /tmp/ruthen/indexer.sock (file operations)
 *   SANDBOX — /tmp/ruthen/sandbox.sock  (command execution)
 *
 * Every request is a single JSON line terminated by '\n'.
 * Every response is a single JSON line terminated by '\n'.
 * Indexer requests auto-inject auth_token.
 */

import net from 'net';

const SANDBOX_SOCKET = '/tmp/ruthen/sandbox.sock';
const INDEXER_SOCKET = '/tmp/ruthen/indexer.sock';
const AUTH_TOKEN = 'uds-internal-trust';

let _reqId = 1;
function nextId() {
    return _reqId++;
}

function callSocket(socketPath, method, params) {
    return new Promise((resolve, reject) => {
        const request = JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: nextId(),
        }) + '\n';

        const client = net.createConnection(socketPath, () => {
            client.write(request);
        });

        let buf = '';
        const TIMEOUT = 60000;
        const timer = setTimeout(() => {
            client.destroy();
            reject(new Error(`UDS call to ${socketPath}/${method} timed out after ${TIMEOUT}ms`));
        }, TIMEOUT);

        client.on('data', (chunk) => {
            buf += chunk.toString();

            const newlineIdx = buf.indexOf('\n');
            if (newlineIdx !== -1) {
                const line = buf.slice(0, newlineIdx);
                clearTimeout(timer);
                client.destroy();

                if (line.length > 10 * 1024 * 1024) {
                    reject(new Error('Response exceeded 10MB payload ceiling'));
                    return;
                }

                try {
                    const parsed = JSON.parse(line);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error(`Failed to parse JSON-RPC response: ${e.message}`));
                }
            }
        });

        client.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`UDS connection error to ${socketPath}: ${err.message}`));
        });

        client.on('close', () => {
            clearTimeout(timer);
            if (!buf) {
                reject(new Error(`UDS connection closed without response from ${socketPath}`));
            }
        });
    });
}

export function callIndexer(method, params = {}) {
    return callSocket(INDEXER_SOCKET, method, {
        ...params,
        auth_token: AUTH_TOKEN,
    });
}

export function callSandbox(method, params = {}) {
    return callSocket(SANDBOX_SOCKET, method, params);
}

export function isSandboxViolation(response) {
    if (response && response.error) {
        const code = response.error.code;
        if (code >= 1000 && code <= 1003) {
            return {
                code,
                message: response.error.message || 'Sandbox violation',
                verdict: response.result?.verdict || '',
            };
        }
    }
    return null;
}
