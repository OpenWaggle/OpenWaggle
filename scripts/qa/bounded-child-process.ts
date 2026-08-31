import { spawn } from 'node:child_process'
import path from 'node:path'
import { stopProcessTree } from './child-process-lifecycle'

export interface RunProcessOptions {
  readonly timeoutMs?: number
}

export async function runProcess(
  command: string,
  args: readonly string[],
  env: Record<string, string>,
  options: RunProcessOptions = {},
) {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, [...args], {
      detached: process.platform !== 'win32',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let outcomeOwned = false
    let timeout: NodeJS.Timeout | undefined
    const finish = (complete: () => void) => {
      if (outcomeOwned) return
      outcomeOwned = true
      if (timeout !== undefined) clearTimeout(timeout)
      complete()
    }
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.once('error', (error) => finish(() => reject(error)))
    child.once('exit', (code, signal) => {
      finish(() => {
        if (code === 0) return resolve({ stdout, stderr })
        reject(
          new Error(
            `${path.basename(command)} ${args.join(' ')} failed (${code ?? signal}): ${stderr || stdout}`,
          ),
        )
      })
    })
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        if (outcomeOwned) return
        outcomeOwned = true
        const timeoutError = new Error(
          `${path.basename(command)} timed out after ${String(options.timeoutMs)}ms.`,
        )
        void stopProcessTree(child).then(
          () => reject(timeoutError),
          (cleanupError: unknown) =>
            reject(
              new AggregateError(
                [timeoutError, cleanupError],
                `${path.basename(command)} timed out and process-tree cleanup failed.`,
              ),
            ),
        )
      }, options.timeoutMs)
    }
  })
}
