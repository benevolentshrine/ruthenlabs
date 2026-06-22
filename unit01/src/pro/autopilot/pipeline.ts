import chalk from 'chalk';
import { execSync } from 'child_process';

const themeAccent = chalk.hex('#38BDF8');
const themeGold = chalk.hex('#F59E0B');
const themeRose = chalk.hex('#F87171');

export interface PipelineResult {
  success: boolean;
  iterations: number;
  logs: string[];
}

export class StructuredBuildPipeline {
  private workspaceRoot: string;
  private testCommand: string;
  private maxIterations: number;

  constructor(workspaceRoot: string, testCommand = 'npm test', maxIterations = 5) {
    this.workspaceRoot = workspaceRoot;
    this.testCommand = testCommand;
    this.maxIterations = maxIterations;
  }

  /**
   * Run the Plan-Code-Test-Healing pipeline loop.
   * Runs tests, feeds compiler warnings back to the model, and iterates.
   */
  public async executePipeline(
    applyChanges: () => Promise<void>,
    promptSelfHeal: (errorLog: string) => Promise<boolean>
  ): Promise<PipelineResult> {
    const logs: string[] = [];
    let iterations = 0;
    let success = false;

    console.log(`\n  ${themeAccent('pipeline')} Starting Structured Build Pipeline`);
    console.log(`  ${themeAccent('pipeline')} Active Workspace: ${this.workspaceRoot}`);
    console.log(`  ${themeAccent('pipeline')} Test command: ${this.testCommand}\n`);

    while (iterations < this.maxIterations) {
      iterations++;
      console.log(`  ${themeGold('pipeline')} [Iteration ${iterations}/${this.maxIterations}] Applying code modifications...`);
      
      // 1. Write the edits to workspace
      await applyChanges();

      // 2. Compile and run test commands inside the workspace directory
      console.log(`  ${themeAccent('pipeline')} Running compile/test verification...`);
      const testResult = this.runBuildVerification();

      if (testResult.passed) {
        console.log(`  ${themeAccent('pipeline')} ${chalk.green('✓ Verification passed successfully!')}`);
        success = true;
        break;
      }

      console.log(`  ${themeRose('pipeline')} ✗ Build failed. Error logs captured.`);
      logs.push(`Iteration ${iterations} Failure:\n${testResult.output}`);

      if (iterations >= this.maxIterations) {
        console.log(`  ${themeRose('pipeline')} ✗ Self-healing limit reached (${this.maxIterations}). Halting execution.`);
        break;
      }

      // 3. Trigger Self-Healing loop
      console.log(`  ${themeGold('pipeline')} Feeding stack trace to LLM for self-correction...`);
      const healSuccessful = await promptSelfHeal(testResult.output);

      if (!healSuccessful) {
        console.log(`  ${themeRose('pipeline')} ✗ Model aborted self-healing.`);
        break;
      }
    }

    return {
      success,
      iterations,
      logs
    };
  }

  /**
   * Synchronously run test/build command inside the workspace directory.
   */
  private runBuildVerification(): { passed: boolean; output: string } {
    try {
      const output = execSync(this.testCommand, {
        cwd: this.workspaceRoot,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, CI: 'true' } // Force non-interactive test mode
      });
      return { passed: true, output };
    } catch (err: any) {
      const errorOutput = err.stdout || err.stderr || err.message || 'Unknown compilation error';
      return { passed: false, output: errorOutput };
    }
  }
}
