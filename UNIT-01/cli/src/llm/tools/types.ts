import type { LocalIndexer as IndexerClient } from '../../indexer/local.js'
import type { LocalSandbox as SandboxClient } from '../../sandbox/runner.js'

export interface ToolContext {
  indexer: IndexerClient;
  sandbox: SandboxClient;
  onProgress?: (progressResult: string) => void;
}

export interface ToolRunner {
  execute(args: any, ctx: ToolContext): Promise<string> | string;
}
