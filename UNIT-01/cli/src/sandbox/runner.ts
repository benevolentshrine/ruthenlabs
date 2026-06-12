import { createServer, Socket } from 'net';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

// ── In-Process HTTP CONNECT Proxy for lockfile domain allowlists ─────────────
export class LocalProxy {
  private server: any = null;
  private port: number = 0;
  private allowedDomains: Set<string> = new Set();

  async start(allowedDomains: string[]): Promise<number> {
    this.allowedDomains = new Set(allowedDomains.map(d => d.toLowerCase()));

    return new Promise((resolve, reject) => {
      this.server = createServer((clientSocket) => {
        this.handleConnection(clientSocket);
      });

      this.server.on('error', (err: any) => {
        reject(err);
      });

      // Bind to localhost on a random port
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  setAllowedDomains(domains: string[]) {
    this.allowedDomains = new Set(domains.map(d => d.toLowerCase()));
  }

  private handleConnection(clientSocket: Socket) {
    clientSocket.once('data', (data) => {
      const request = data.toString();
      const firstLine = request.split('\r\n')[0];
      const parts = firstLine.split(' ');

      if (parts.length < 2) {
        clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        clientSocket.end();
        return;
      }

      const method = parts[0];
      const url = parts[1];

      let host = '';
      let port = 80;

      if (method === 'CONNECT') {
        const hostParts = url.split(':');
        host = hostParts[0];
        port = parseInt(hostParts[1] || '443', 10);
      } else {
        try {
          const parsedUrl = new URL(url);
          host = parsedUrl.hostname;
          port = parseInt(parsedUrl.port || '80', 10);
        } catch {
          const hostHeader = request.split('\r\n').find(l => l.toLowerCase().startsWith('host:'));
          if (hostHeader) {
            const h = hostHeader.split(':')[1].trim();
            const hostParts = h.split(':');
            host = hostParts[0];
            port = parseInt(hostParts[1] || '80', 10);
          }
        }
      }

      if (!host) {
        clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        clientSocket.end();
        return;
      }

      if (!this.isDomainAllowed(host)) {
        // Forbidden
        clientSocket.write('HTTP/1.1 403 Forbidden\r\nProxy-Agent: Ruthen-Sandbox-TS\r\n\r\n');
        clientSocket.end();
        return;
      }

      // Relay
      const upstreamSocket = new Socket();
      upstreamSocket.connect(port, host, () => {
        if (method === 'CONNECT') {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          clientSocket.pipe(upstreamSocket);
          upstreamSocket.pipe(clientSocket);
        } else {
          upstreamSocket.write(data);
          clientSocket.pipe(upstreamSocket);
          upstreamSocket.pipe(clientSocket);
        }
      });

      upstreamSocket.on('error', () => {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        clientSocket.end();
      });

      clientSocket.on('error', () => {
        upstreamSocket.end();
      });
    });
  }

  private isDomainAllowed(host: string): boolean {
    const lowerHost = host.toLowerCase();
    if (lowerHost === 'localhost' || lowerHost === '127.0.0.1' || lowerHost === '::1') {
      return true;
    }
    for (const domain of this.allowedDomains) {
      if (lowerHost === domain || lowerHost.endsWith('.' + domain)) {
        return true;
      }
    }
    return false;
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

// ── Local Sandbox Manager ───────────────────────────────────────────────────
export interface SandboxPolicy {
  enabled?: boolean;
  deny_network?: boolean;
  allowed_domains?: string[];
  excluded_commands?: string[];
  allow_write_paths?: string[];
  deny_write_paths?: string[];
  deny_read_paths?: string[];
  ecosystems?: string[];
}

export class LocalSandbox {
  private workspace: string = process.cwd();
  private policy: Required<SandboxPolicy>;
  private proxy: LocalProxy = new LocalProxy();
  private proxyPort: number | null = null;

  constructor() {
    this.policy = {
      enabled: true,
      deny_network: true,
      allowed_domains: [],
      excluded_commands: [
        "docker", "docker-compose", "podman", "nerdctl", "buildah",
        "sudo", "su", "doas", "pkexec", "nsenter", "unshare",
        "mount", "umount", "modprobe", "insmod", "rmmod", "modinfo",
        "systemctl", "systemd", "journalctl", "flatpak", "snap",
        "apptainer", "singularity", "sandbox"
      ],
      allow_write_paths: [],
      deny_write_paths: [],
      deny_read_paths: [],
      ecosystems: []
    };
  }

  setWorkspace(path: string) {
    this.workspace = resolve(path);
    return { verdict: 'OK', audit_ref: '' };
  }

  async setPolicy(policy: SandboxPolicy) {
    this.policy = {
      ...this.policy,
      ...policy
    };

    // Restart proxy if domains list changes and network is denied
    if (this.policy.deny_network && this.policy.allowed_domains && this.policy.allowed_domains.length > 0) {
      this.proxy.stop();
      try {
        this.proxyPort = await this.proxy.start(this.policy.allowed_domains);
      } catch (e) {
        console.error('Failed to start local egress proxy:', e);
      }
    } else {
      this.proxy.stop();
      this.proxyPort = null;
    }

    return { verdict: 'OK', audit_ref: '' };
  }

  private generateSeatbeltProfile(tempDir: string, denyNetwork: boolean): string {
    const homeDir = process.env.HOME || '/tmp';
    const systemRoPaths = [
      "/usr/lib", "/System/Library", "/usr/bin", "/bin",
      "/usr/sbin", "/sbin", "/usr/local/bin", "/usr/local/lib",
      "/usr/share", "/etc", "/dev", "/private"
    ];
    if (existsSync("/opt/homebrew")) systemRoPaths.push("/opt/homebrew");
    if (existsSync(`${homeDir}/.bun`)) systemRoPaths.push(`${homeDir}/.bun`);
    if (existsSync(`${homeDir}/.nvm`)) systemRoPaths.push(`${homeDir}/.nvm`);
    if (existsSync(`${homeDir}/.cargo`)) systemRoPaths.push(`${homeDir}/.cargo`);
    const sensitivePaths = [
      "/.ssh", "/.aws", "/.config/git", "/.gnupg", "/.netrc",
      "/.npmrc", "/.docker", "/.kube", "/.azure", "/.gpg"
    ];

    let p = `(version 1)\n(deny default)\n`;

    // Read/write workspace & temp dir
    p += `(allow file-read* (subpath "${this.workspace}"))\n`;
    p += `(allow file-write* (subpath "${this.workspace}"))\n`;
    p += `(allow file-read* (subpath "${tempDir}"))\n`;
    p += `(allow file-write* (subpath "${tempDir}"))\n`;

    // Root directory read resolution
    p += `(allow file-read* (literal "/"))\n`;
    p += `(allow file-map-executable)\n`;

    // Allow reading parent directories up to root so path resolution/realpath works
    let current = this.workspace;
    while (current && current !== '/' && current !== '.') {
      p += `(allow file-read* (literal "${current}"))\n`;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    // Read-only system paths
    for (const s of systemRoPaths) {
      p += `(allow file-read* (subpath "${s}"))\n`;
    }

    // Deny access to sensitive credentials
    for (const suffix of sensitivePaths) {
      p += `(deny file-read* (subpath "${homeDir}${suffix}"))\n`;
    }

    // Custom denies
    for (const dr of this.policy.deny_read_paths) {
      p += `(deny file-read* (subpath "${dr}"))\n`;
    }
    for (const dw of this.policy.deny_write_paths) {
      p += `(deny file-write* (subpath "${dw}"))\n`;
    }

    // Custom allow writes
    for (const aw of this.policy.allow_write_paths) {
      p += `(allow file-write* (subpath "${aw}"))\n`;
    }

    // Allowed executions & hooks
    p += `(allow process-exec*)\n`;
    p += `(allow process-fork)\n`;
    p += `(allow sysctl-read)\n`;
    p += `(allow mach*)\n`;
    p += `(allow ipc*)\n`;
    p += `(allow signal)\n`;
    p += `(allow system-socket)\n`;
    p += `(allow system-fsctl)\n`;
    p += `(allow system-info)\n`;

    // Egress
    if (denyNetwork) {
      p += `(deny network-outbound)\n`;
      p += `(allow network-outbound (remote ip "localhost:*"))\n`;
      p += `(allow network* (local ip "localhost:*"))\n`;
    } else {
      p += `(allow network*)\n`;
    }

    return p;
  }

  private buildBubblewrapCommand(cmd: string, tempDir: string, denyNetwork: boolean): string[] {
    const homeDir = process.env.HOME || '/tmp';
    const bwrapArgs = [
      'bwrap',
      '--ro-bind', '/', '/',          // Read-only bind root (default deny write)
      '--bind', this.workspace, this.workspace,
      '--bind', tempDir, tempDir,
      '--dev', '/dev',
      '--proc', '/proc',
      '--tmpfs', '/tmp'
    ];

    for (const aw of this.policy.allow_write_paths) {
      bwrapArgs.push('--bind', aw, aw);
    }
    for (const dr of this.policy.deny_read_paths) {
      bwrapArgs.push('--ro-bind', '/dev/null', dr);
    }
    for (const dw of this.policy.deny_write_paths) {
      bwrapArgs.push('--ro-bind', dw, dw);
    }

    const sensitivePaths = [
      "/.ssh", "/.aws", "/.config/git", "/.gnupg", "/.netrc",
      "/.npmrc", "/.docker", "/.kube", "/.azure", "/.gpg"
    ];
    for (const suffix of sensitivePaths) {
      const fullPath = `${homeDir}${suffix}`;
      if (existsSync(fullPath)) {
        bwrapArgs.push('--ro-bind', '/dev/null', fullPath);
      }
    }

    if (denyNetwork) {
      bwrapArgs.push('--unshare-net');
    }

    bwrapArgs.push('--chdir', this.workspace);
    bwrapArgs.push('--', 'sh', '-c', `ulimit -v 2097152 -u 64 && ${cmd}`);

    return bwrapArgs;
  }

  async execute(cmd: string, opts: { allow_network?: boolean; timeout_ms?: number; onOutput?: (chunk: string) => void } = {}) {
    const isMac = process.platform === 'darwin';
    const isLinux = process.platform === 'linux';

    const allowNetworkOverride = opts.allow_network;
    const effectiveDeny = allowNetworkOverride !== undefined ? !allowNetworkOverride : this.policy.deny_network;

    // Check excluded commands (basename match)
    const binaryName = cmd.trim().split(/\s+/)[0];
    const basename = binaryName.split('/').pop() || binaryName;
    if (this.policy.excluded_commands.includes(basename)) {
      throw new Error(
        `Command '${basename}' is excluded from sandbox execution. \
This tool requires kernel features blocked by the sandbox. \
Please run it outside the sandbox or request elevated privileges.`
      );
    }

    // Isolated temp directory
    const tempDir = join(this.workspace, `.unit01-tmp-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });

    let finalCommand = 'sh';
    let finalArgs = ['-c', `ulimit -v 2097152 -u 64 && ${cmd}`];

    if (this.policy.enabled) {
      if (isMac) {
        const profile = this.generateSeatbeltProfile(tempDir, effectiveDeny);
        finalCommand = '/usr/bin/sandbox-exec';
        finalArgs = ['-p', profile, '--', 'sh', '-c', `ulimit -v 2097152 -u 64 && ${cmd}`];
      } else if (isLinux && existsSync('/usr/bin/bwrap')) {
        finalCommand = 'bwrap';
        finalArgs = this.buildBubblewrapCommand(cmd, tempDir, effectiveDeny).slice(1);
      }
    }

    const env = { ...process.env, HOME: this.workspace, TMPDIR: tempDir };

    if (effectiveDeny && this.proxyPort) {
      const proxyUrl = `http://127.0.0.1:${this.proxyPort}`;
      Object.assign(env, {
        HTTP_PROXY: proxyUrl,
        HTTPS_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        https_proxy: proxyUrl,
        ALL_PROXY: proxyUrl,
        all_proxy: proxyUrl,
        NO_PROXY: 'localhost,127.0.0.1,::1',
        no_proxy: 'localhost,127.0.0.1,::1',
        npm_config_proxy: proxyUrl,
        npm_config_https_proxy: proxyUrl,
        NODE_EXTRA_CA_CERTS: ''
      });
    }

    return new Promise<{ verdict: string; audit_ref: string }>((resolve, reject) => {
      const child = spawn(finalCommand, finalArgs, {
        cwd: this.workspace,
        env,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (opts.onOutput) {
          opts.onOutput(chunk);
        }
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (opts.onOutput) {
          opts.onOutput(chunk);
        }
      });

      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }, 1000);
      }, opts.timeout_ms || 30000);

      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        // Clean up temp dir
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}

        if (signal) {
          reject(new Error(`Sandbox Violation: Process terminated by signal ${signal}`));
          return;
        }

        const verdict = `STDOUT:\n${stdout}\nSTDERR:\n${stderr}`;
        if (code !== 0 && code !== null) {
          if (code === 1 && (stderr.includes('Permission denied') || stderr.includes('Operation not permitted'))) {
            reject(new Error(`Sandbox Violation: Filesystem write blocked.\n\n${verdict}`));
          } else {
            resolve({ verdict, audit_ref: '' });
          }
        } else {
          resolve({ verdict, audit_ref: '' });
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
        reject(err);
      });
    });
  }

  close() {
    this.proxy.stop();
  }
}
