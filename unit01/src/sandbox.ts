import { spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { EgressProxy, TIER1_DOMAINS, detectTier2Domains } from './proxy.js';

const themePrimary = chalk.hex('#9333EA');

const BLACKLIST = new Set(['sudo', 'su', 'docker', 'podman', 'mount', 'umount', 'nsenter', 'unshare']);

const SECRET_PATTERNS = [
  /AKIA[0-9A-Z]{16}/g, // AWS Access Key ID
  /gh[opru]_[0-9a-zA-Z]{36,255}/g, // GitHub Token
  /eyJhbGciOi[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*/g, // JWT Token
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[a-zA-Z0-9/\+=\s\n]+-----END [A-Z ]+ PRIVATE KEY-----/g, // SSH Key
  /xox[bapr]-[0-9]{12}-[0-9]{12}-[0-9]{12}-[a-z0-9]{32}/g, // Slack token
  /sk_live_[0-9a-zA-Z]{24}/g, // Stripe Key
  /AIza[0-9A-Za-z-_]{35}/g, // Google Key
  /(?:aws_secret|aws_token|secret_key|secret)\s*[:=]\s*['\"][A-Za-z0-9/+=]{40}['\"]/gi, // AWS Secret Key assignment
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, // Bearer Token
  /(?:api_key|apikey|password|passwd|token|auth_token)\s*[:=]\s*['\"][^'\"]{10,100}['\"]/gi // Generic credentials
];

export function redactSecrets(content: string): string {
  let redacted = content;
  for (const regex of SECRET_PATTERNS) {
    redacted = redacted.replace(regex, '[REDACTED]');
  }
  return redacted;
}

export function truncateOutput(output: string): string {
  if (output.length <= 2000) {
    return output;
  }
  const first500 = output.slice(0, 500);
  const last500 = output.slice(-500);
  const omittedBytes = output.length - 1000;
  return `${first500}\n\n[${omittedBytes} bytes omitted in middle]\n\n${last500}`;
}

export function containsCdCommand(command: string): boolean {
  // Checks if cd exists with word boundary, indicating a directory change attempt
  const cdRegex = /(?:^|;|&&|\|\||\|)\s*cd\b/;
  return cdRegex.test(command);
}

export function isBlacklisted(command: string): boolean {
  const parts = command.split(/(?:;|&&|\|\||\|)/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const firstWord = trimmed.split(/\s+/)[0];
    if (BLACKLIST.has(firstWord)) {
      return true;
    }
  }
  return false;
}

export class LoopDetector {
  private commandHistory: string[] = [];
  private outputHistory: string[] = [];

  public checkLoop(command: string): boolean {
    if (this.commandHistory.length >= 3) {
      const last3Cmds = this.commandHistory.slice(-3);
      const allSameCmd = last3Cmds.every(cmd => cmd === command);

      // If the exact same command is executed 3 times sequentially, trigger loop detection
      if (allSameCmd) {
        return true;
      }

      // Also check if the outputs are identical (non-empty)
      const last3Outputs = this.outputHistory.slice(-3);
      const allSameOutput = last3Outputs.every(out => out && out === last3Outputs[0]);
      if (allSameOutput) {
        return true;
      }
    }
    return false;
  }

  public record(command: string, output: string) {
    this.commandHistory.push(command);
    this.outputHistory.push(output);

    if (this.commandHistory.length > 5) {
      this.commandHistory.shift();
      this.outputHistory.shift();
    }
  }

  public clear() {
    this.commandHistory = [];
    this.outputHistory = [];
  }
}

export class DirectiveSandbox {
  private workspaceRoot: string;
  private loopDetector = new LoopDetector();
  private egressProxy: EgressProxy | null = null;
  private proxyPort: number = 0;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
  }

  /**
   * Initializes the Sandbox, starting the egress proxy.
   */
  public async initialize(tier3Domains: string[] = []) {
    // Collect allowed domains (Tier 1 + Tier 2 + Tier 3)
    const allowed = new Set<string>(TIER1_DOMAINS);
    
    // Tier 2: Lockfiles auto-detection
    const tier2 = detectTier2Domains(this.workspaceRoot);
    for (const d of tier2) {
      allowed.add(d);
    }

    // Tier 3: User config
    for (const d of tier3Domains) {
      allowed.add(d);
    }

    this.egressProxy = new EgressProxy(allowed);
    this.proxyPort = await this.egressProxy.start();
    console.log(`  ${themePrimary('sandbox')} Egress proxy started on port ${this.proxyPort}`);
  }

  /**
   * Clean up the egress proxy when the sandbox session ends.
   */
  public stop() {
    if (this.egressProxy) {
      this.egressProxy.stop();
      this.egressProxy = null;
    }
  }

  public clearLoopHistory() {
    this.loopDetector.clear();
  }

  private resolvePaths(command: string): string {
    const parts = command.split(/(\s+)/);
    const keywords = new Set(['go', 'run', 'python', 'node', 'npm', 'cargo', 'rustc', 'pip', '&&', '||', '|', ';', '>', '>>', 'cat', 'grep', 'rm', 'mkdir', 'touch']);
    
    const resolvedParts = parts.map(part => {
      const trimmed = part.trim();
      if (!trimmed) return part;
      
      let word = trimmed;
      let quote = '';
      if ((word.startsWith("'") && word.endsWith("'")) || (word.startsWith('"') && word.endsWith('"'))) {
        quote = word[0];
        word = word.slice(1, -1);
      }
      
      if (word.startsWith('-') || word.startsWith('/') || keywords.has(word)) {
        return part;
      }
      
      const looksLikePath = word.includes('/') || word.startsWith('.') || /\.[a-zA-Z0-9]+$/.test(word);
      const absPath = path.resolve(this.workspaceRoot, word);
      let exists = false;
      try {
        exists = fs.existsSync(absPath);
      } catch (e) {}
      
      if (exists || looksLikePath) {
        return quote + absPath + quote;
      }
      
      return part;
    });
    
    return resolvedParts.join('');
  }

  private isCommandAvailable(cmd: string): boolean {
    try {
      execSync(`which ${cmd}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Execute a shell command inside the sandbox container.
   */
  public async runCommand(command: string): Promise<string> {
    const resolvedCommand = this.resolvePaths(command.trim());
    const trimmedCommand = resolvedCommand.trim();

    // 1. Block cd commands
    if (containsCdCommand(trimmedCommand)) {
      return '[DIRECTIVE AI] Directory changes not allowed. Use absolute paths.';
    }

    // 2. Blacklist check
    if (isBlacklisted(trimmedCommand)) {
      return '[DIRECTIVE AI] Command not allowed by security policy.';
    }

    // 3. Loop detection check
    if (this.loopDetector.checkLoop(trimmedCommand)) {
      return '[DIRECTIVE AI] Loop detected: same command executed 3 times with same result. Stop and reconsider your approach.';
    }

    // 4. Set up resource limit ulimit prefix
    // Limits: 2GB RAM (ulimit -v, Linux only), 64 processes (ulimit -u, Linux only), 256 FDs (ulimit -n)
    const isLinux = process.platform === 'linux';
    const ulimitPrefix = isLinux
      ? 'ulimit -v 2097152 && ulimit -u 64 && ulimit -n 256'
      : 'ulimit -n 256';
    const innerCommand = `${ulimitPrefix} && ${trimmedCommand}`;

    // 5. Setup sandboxing engine wrapping command
    let execCommand = '/bin/sh';
    let execArgs = ['-c', innerCommand];
    let tempSeatbeltProfile: string | null = null;

    const hasSeatbelt = process.platform === 'darwin' && this.isCommandAvailable('sandbox-exec');
    const hasBubblewrap = process.platform === 'linux' && this.isCommandAvailable('bwrap');

    if (hasSeatbelt) {
      // macOS Seatbelt sandbox
      tempSeatbeltProfile = path.join(os.tmpdir(), `seatbelt-${crypto.randomBytes(8).toString('hex')}.sb`);
      const profileContent = `(version 1)
(allow default)
(deny file-write*
  (subpath "/System")
  (subpath "/usr")
  (subpath "/bin")
  (subpath "/sbin")
  (subpath "/private/etc")
  (subpath "/etc")
  (subpath "/var/root")
  (subpath "/private/var/db")
)
`;
      fs.writeFileSync(tempSeatbeltProfile, profileContent, 'utf-8');
      
      execCommand = 'sandbox-exec';
      execArgs = ['-f', tempSeatbeltProfile, '/bin/sh', '-c', innerCommand];
    } else if (hasBubblewrap) {
      // Linux bubblewrap sandbox
      execCommand = 'bwrap';
      execArgs = [
        '--ro-bind', '/', '/',
        '--bind', '/tmp', '/tmp',
        '--bind', this.workspaceRoot, this.workspaceRoot,
        '--dev-bind', '/dev', '/dev',
        '--proc', '/proc',
        '--unshare-all',
        '--share-net',
        '/bin/sh', '-c', innerCommand
      ];
    } else {
      console.warn('[Directive AI Sandbox] Sandboxing engines (bwrap / sandbox-exec) not available. Running in un-isolated mode with resource limits.');
    }

    // 6. Spawn process with proxy configuration
    const proxyUrl = `http://127.0.0.1:${this.proxyPort}`;
    const env = {
      ...process.env,
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl
    };

    return new Promise((resolve) => {
      let outputBuffer = '';
      const child = spawn(execCommand, execArgs, {
        cwd: this.workspaceRoot,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      child.stdout.on('data', (data) => {
        outputBuffer += data.toString();
      });

      child.stderr.on('data', (data) => {
        outputBuffer += data.toString();
      });

      // Implement timeout logic: 30 seconds SIGTERM -> wait 2s -> SIGKILL
      let killed = false;
      const timeoutTimer = setTimeout(() => {
        console.warn(`[Directive AI Sandbox] Command timed out after 30s: "${trimmedCommand}". Sending SIGTERM...`);
        killed = true;
        child.kill('SIGTERM');

        const killForceTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, 2000);

        child.once('close', () => {
          clearTimeout(killForceTimer);
        });
      }, 30000);

      child.on('close', (code) => {
        clearTimeout(timeoutTimer);

        // Delete temporary seatbelt file if created
        if (tempSeatbeltProfile && fs.existsSync(tempSeatbeltProfile)) {
          try {
            fs.unlinkSync(tempSeatbeltProfile);
          } catch (e) {
            // ignore
          }
        }

        let result = outputBuffer;
        if (killed) {
          result += '\n[Directive AI] Process terminated: execution timed out after 30 seconds.';
        }

        // Apply truncation and secret redaction
        const redacted = redactSecrets(result);
        const truncated = truncateOutput(redacted);

        // Record execution in loop detector
        this.loopDetector.record(trimmedCommand, truncated);

        resolve(truncated);
      });

      child.on('error', (err) => {
        clearTimeout(timeoutTimer);
        if (tempSeatbeltProfile && fs.existsSync(tempSeatbeltProfile)) {
          try {
            fs.unlinkSync(tempSeatbeltProfile);
          } catch (e) {
            // ignore
          }
        }
        resolve(`[Directive AI Sandbox] Execution failed to start: ${err.message}`);
      });
    });
  }
}
