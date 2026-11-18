import { describe, expect, it, vi } from 'vitest'

/** A failed run as Node reports it: the output on the error, next to fields that are not JSON. */
function failedRun() {
  return Object.assign(new Error('Command failed: gh pr view'), {
    code: 1,
    stdout: 'partial output',
    stderr: 'no pull requests found',
    cause: new Error('exit 1'),
    kill: () => undefined,
  })
}

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    _args: readonly string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    queueMicrotask(() => callback(failedRun(), '', ''))
  },
}))

vi.mock('../../../env', () => ({ getSourceControlCliEnv: () => ({}) }))

const { runCli } = await import('../cli-runner')

describe('runCli failed output', () => {
  it('keeps the output of a failed run whose error also holds values that are not JSON', async () => {
    await expect(runCli('gh', ['pr', 'view'], '/repository')).resolves.toEqual({
      stdout: 'partial output',
      stderr: 'no pull requests found',
      code: 1,
      missing: false,
    })
  })
})
