import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import type { ToolDefinition } from '../types.js';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPConfig {
  mcpServers?: Record<string, MCPServerConfig>;
}

const CONFIG_DIR = process.env.UNIT01_CONFIG ?? join(homedir(), '.config', 'unit01');
const MCP_CONFIG_FILE = join(CONFIG_DIR, 'mcp-servers.json');

export class MCPServerConnection {
  private proc: any;
  private name: string;
  private config: MCPServerConfig;
  private nextId = 1;
  private pendingRequests = new Map<number | string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private stdoutBuffer = '';
  private initialized = false;

  constructor(name: string, config: MCPServerConfig) {
    this.name = name;
    this.config = config;
  }

  async start(): Promise<void> {
    const cmd = [this.config.command, ...(this.config.args ?? [])];
    const env = { ...process.env, ...(this.config.env ?? {}) };

    try {
      this.proc = Bun.spawn({
        cmd,
        env,
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      });
    } catch (e: any) {
      throw new Error(`Failed to spawn MCP server ${this.name}: ${e?.message ?? e}`);
    }

    // Start reading stdout
    this.readStdout();
    this.readStderr();

    // Send initialize request
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'unit-01',
        version: '0.1.0',
      },
    });

    // Send initialized notification
    this.notify('notifications/initialized');
    this.initialized = true;
  }

  private async readStdout() {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.rejectAllPending(new Error(`MCP server ${this.name} connection closed`));
          break;
        }
        this.stdoutBuffer += decoder.decode(value, { stream: true });
        let newlineIdx;
        while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
          const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
          this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
          if (line) {
            this.handleMessage(line);
          }
        }
      }
    } catch (e: any) {
      this.rejectAllPending(e);
    }
  }

  private async readStderr() {
    const reader = this.proc.stderr.getReader();
    // Just drain stderr so buffer doesn't clog
    try {
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {}
  }

  private handleMessage(line: string) {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined) {
        // This is a response
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          } else {
            pending.resolve(msg.result);
          }
        }
      }
    } catch (e) {
      // invalid JSON
    }
  }

  request(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const req = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };
      this.pendingRequests.set(id, { resolve, reject });
      try {
        this.proc.stdin.write(JSON.stringify(req) + '\n');
        this.proc.stdin.flush();
      } catch (e) {
        this.pendingRequests.delete(id);
        reject(e);
      }
    });
  }

  notify(method: string, params: any = {}): void {
    const req = {
      jsonrpc: '2.0',
      method,
      params,
    };
    try {
      this.proc.stdin.write(JSON.stringify(req) + '\n');
      this.proc.stdin.flush();
    } catch (e) {
      // failed to write
    }
  }

  private rejectAllPending(err: Error) {
    for (const [id, pending] of this.pendingRequests.entries()) {
      pending.reject(err);
    }
    this.pendingRequests.clear();
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
    }
  }
}

export class MCPManager {
  private connections = new Map<string, MCPServerConnection>();
  private toolToServer = new Map<string, string>();
  private mcpTools: ToolDefinition[] = [];

  async init(): Promise<void> {
    if (!existsSync(MCP_CONFIG_FILE)) {
      return;
    }

    let config: { mcpServers?: Record<string, MCPServerConfig> } = {};
    try {
      config = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));
    } catch (e: any) {
      console.error(`Failed to parse ${MCP_CONFIG_FILE}: ${e?.message ?? e}`);
      return;
    }

    const servers = config.mcpServers ?? {};
    for (const [name, srvConfig] of Object.entries(servers)) {
      try {
        const conn = new MCPServerConnection(name, srvConfig);
        await conn.start();
        this.connections.set(name, conn);

        // Fetch tools
        const toolsResult = await conn.request('tools/list');
        if (toolsResult && Array.isArray(toolsResult.tools)) {
          for (const tool of toolsResult.tools) {
            const ollamaTool: ToolDefinition = {
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description ?? '',
                parameters: {
                  type: 'object',
                  properties: tool.inputSchema?.properties ?? {},
                  required: tool.inputSchema?.required ?? [],
                },
              },
            };
            this.mcpTools.push(ollamaTool);
            this.toolToServer.set(tool.name, name);
          }
        }
      } catch (e: any) {
        console.error(`Failed to initialize MCP server "${name}":`, e?.message ?? e);
      }
    }
  }

  getTools(): ToolDefinition[] {
    return this.mcpTools;
  }

  hasTool(name: string): boolean {
    return this.toolToServer.has(name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const serverName = this.toolToServer.get(name);
    if (!serverName) {
      throw new Error(`No MCP server found for tool ${name}`);
    }
    const conn = this.connections.get(serverName);
    if (!conn) {
      throw new Error(`MCP server ${serverName} is not connected`);
    }

    const result = await conn.request('tools/call', {
      name,
      arguments: args,
    });

    if (!result) {
      throw new Error(`MCP tool ${name} returned no response`);
    }

    if (result.isError) {
      const errorMsg = result.content?.map((c: any) => c.text ?? '').join('\n') || 'Unknown error';
      throw new Error(errorMsg);
    }

    const text = result.content?.map((c: any) => c.text ?? '').join('\n') || '';
    return text;
  }

  shutdown(): void {
    for (const conn of this.connections.values()) {
      conn.stop();
    }
    this.connections.clear();
    this.toolToServer.clear();
    this.mcpTools = [];
  }
}

export const mcpManager = new MCPManager();
