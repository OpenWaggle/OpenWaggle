/**
 * The child-process runner the agent gate uses: bounded output, a timeout, an abort signal and
 * optional stdin. It never throws. A process that could not start or was killed by the timeout
 * comes back with `code: null` and `timedOut` set accordingly, so a check can tell a tool failure
 * from findings.
 */
import { spawn } from 'node:child_process'

export interface ProcessResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface RunOptions {
  readonly cwd: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly input?: string
  readonly env?: NodeJS.ProcessEnv
}

export type RunProcess = (
  command: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<ProcessResult>

// Lint and git output for a turn's files stays far below this; anything larger is cut off.
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024

export const runProcess: RunProcess = (command, args, options) =>
  new Promise((resolve) => {
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let size = 0
    let timedOut = false
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_OUTPUT_BYTES) target.push(chunk)
    }
    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: null, stdout: '', stderr: error.message, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: timedOut ? null : code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
      })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input ?? '')
  })

/** `git <args>` in `cwd`; stdout on success, undefined on any failure. */
export async function git(
  run: RunProcess,
  cwd: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string | undefined> {
  const result = await run('git', args, { cwd, timeoutMs })
  return result.code === 0 ? result.stdout : undefined
}
