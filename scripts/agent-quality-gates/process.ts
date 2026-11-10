/**
 * A small child-process runner for the agent quality gates: bounded output, a timeout, an abort
 * signal, and optional stdin. It never throws; a failure to start comes back as `code: null`.
 */
import { spawn } from 'node:child_process'

export interface ProcessResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface RunOptions {
  readonly cwd: string
  readonly signal?: AbortSignal
  readonly timeoutMs: number
  readonly input?: string
  readonly env?: NodeJS.ProcessEnv
}

export type RunProcess = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<ProcessResult>

// Tool reports for a whole repository stay well under this; anything larger is cut off.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

export const runProcess: RunProcess = (command, args, options) =>
  new Promise((resolve) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      timeout: options.timeoutMs,
    })
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_OUTPUT_BYTES) {
        target.push(chunk)
      }
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', () => {
      resolve({ code: null, stdout: '', stderr: '' })
    })
    child.on('close', (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')
  })
