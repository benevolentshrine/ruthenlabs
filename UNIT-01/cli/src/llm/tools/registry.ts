import type { ToolRunner } from './types.js'
import { ReadFileRunner, WriteFileRunner, PatchFileRunner, PatchFileBlocksRunner } from './file.js'
import { RunCommandRunner, DiagnosticsRunner } from './command.js'
import { SearchCodeRunner, ListDirRunner } from './search.js'
import { GitStatusRunner } from './git.js'

export const toolRegistry: Record<string, ToolRunner> = {
  read_file: new ReadFileRunner(),
  write_file: new WriteFileRunner(),
  patch_file: new PatchFileRunner(),
  patch_file_blocks: new PatchFileBlocksRunner(),
  run_command: new RunCommandRunner(),
  search_code: new SearchCodeRunner(),
  list_dir: new ListDirRunner(),
  git_status: new GitStatusRunner(),
  diagnostics: new DiagnosticsRunner(),
}
