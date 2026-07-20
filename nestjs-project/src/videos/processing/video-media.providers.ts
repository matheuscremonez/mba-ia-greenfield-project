import type { Provider } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { PROCESS_COMMAND_RUNNER } from './video-media.tokens';
import type { ProcessCommandRunner } from './video-media.types';

const MAX_STDOUT_BYTES = 2 * 1024 * 1024;
const MAX_STDERR_BYTES = 32 * 1024;

export const runProcessCommand: ProcessCommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        child.kill('SIGKILL');
        reject(new Error('Process output exceeded the allowed size'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= MAX_STDERR_BYTES) {
        stderr.push(chunk);
      }
    });
    child.once('error', reject);
    child.once('close', (code) => {
      const output = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`));
      }
    });
  });

export const videoMediaProviders: Provider[] = [
  { provide: PROCESS_COMMAND_RUNNER, useValue: runProcessCommand },
];
