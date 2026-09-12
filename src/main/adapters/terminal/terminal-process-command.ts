import { execFile } from 'node:child_process'
import { getSafeChildEnv } from '../../env'

const EXEC_TIMEOUT_MS = 4_000

export interface TerminalProcessCommandResult {
  readonly ok: boolean
  readonly output: string
  readonly errorOutput: string
  readonly exitCode: string | number | null
}

function childProcessExitCode(error: Error | null): string | number | null {
  if (error === null || !('code' in error)) return null
  const code: unknown = error.code
  return typeof code === 'string' || typeof code === 'number' ? code : null
}

function childEnvironment() {
  return Object.fromEntries(
    Object.entries(getSafeChildEnv()).filter((entry) => entry[1] !== undefined),
  )
}

export function runTerminalProcessCommand(
  command: string,
  args: readonly string[],
  timeoutMs = EXEC_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<TerminalProcessCommandResult> {
  return new Promise((resolve) => {
    const finish = (error: Error | null, stdout = '', stderr = '') => {
      resolve({
        ok: error === null,
        output: stdout,
        errorOutput: stderr,
        exitCode: childProcessExitCode(error),
      })
    }
    try {
      const options = {
        env: childEnvironment(),
        timeout: timeoutMs,
        ...(signal === undefined ? {} : { signal }),
      }
      execFile(command, [...args], options, (error, stdout, stderr) => {
        finish(error, stdout, stderr)
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
