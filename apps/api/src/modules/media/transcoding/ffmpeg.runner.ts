import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';

/**
 * Result of a single ffmpeg / ffprobe invocation.
 *
 * `stdout` / `stderr` are kept as strings because we only ever run short
 * commands (probe + transcode of a single variant); buffering them in
 * memory is fine and lets the worker include their tails in failure
 * messages.
 */
export interface FfmpegExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Thin abstraction over `child_process.spawn` so tests can swap a mocked
 * implementation in via the DI container without ever touching the real
 * ffmpeg binary.
 *
 * The contract is intentionally tiny:
 *   - `run(binary, args)` resolves with the captured stdout/stderr and
 *     the exit code, regardless of whether the process exits 0 or non-0.
 *     Callers are expected to inspect `exitCode` themselves.
 *   - `run` rejects only on _spawn_ errors (e.g. the binary is missing).
 *     Non-zero exit codes are not treated as exceptions because ffprobe
 *     legitimately uses them in some informational paths.
 *
 * Production: `FfmpegRunner` (this class).
 * Tests: substitute with `FakeFfmpegRunner` in the spec — see
 * `transcode.processor.spec.ts`.
 */
export abstract class FfmpegRunner {
  abstract run(binary: string, args: readonly string[]): Promise<FfmpegExecResult>;
}

/**
 * Default implementation backed by `child_process.spawn`. Stdout/stderr
 * streams are accumulated in memory; a large transcode of a multi-GB
 * video produces tens of KB of ffmpeg output at most, so this is safe.
 */
@Injectable()
export class SpawnFfmpegRunner extends FfmpegRunner {
  private readonly logger = new Logger(SpawnFfmpegRunner.name);

  async run(
    binary: string,
    args: readonly string[],
  ): Promise<FfmpegExecResult> {
    return new Promise((resolve, reject) => {
      this.logger.debug(`spawn ${binary} ${args.join(' ')}`);
      const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        resolve({
          exitCode: code ?? -1,
          stdout,
          stderr,
        });
      });
    });
  }
}
