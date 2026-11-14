import { describe, expect, it, vi } from 'vitest'

/*
 * Bun reports a `maxBuffer` overflow with a RangeError whose `code` sits on its prototype, not on
 * the error. Decoding only the error's own properties turned the overflow into an unknown failure.
 */
class InheritedCodeError extends RangeError {}
Object.defineProperty(InheritedCodeError.prototype, 'code', {
  value: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
})

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    _args: readonly string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    queueMicrotask(() => callback(new InheritedCodeError('stdout maxBuffer exceeded'), '', ''))
    return { stdin: { end: () => undefined } }
  },
}))

vi.mock('../../../desktop-shell-environment-process', () => ({
  desktopShellEnvironmentReady: () => Promise.resolve(),
}))

const { runGit } = await import('../run-git')

describe('runGit error codes', () => {
  it('reports a maxBuffer overflow whose code the error inherits', async () => {
    await expect(runGit('/repository', ['diff'])).resolves.toMatchObject({
      code: 1,
      maxBufferExceeded: true,
      executionFailed: true,
    })
  })
})
