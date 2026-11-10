import { describe, expect, it, vi } from 'vitest'

// Bun gives some child-process errors a `code` on their prototype rather than on the error.
class InheritedCodeError extends Error {}
Object.defineProperty(InheritedCodeError.prototype, 'code', { value: 'ENOENT' })

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    _args: readonly string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void,
  ) => {
    queueMicrotask(() => callback(new InheritedCodeError('spawn gh ENOENT'), '', ''))
  },
}))

vi.mock('../../../env', () => ({ getSourceControlCliEnv: () => ({}) }))

const { runCli } = await import('../cli-runner')

describe('runCli error codes', () => {
  it('reports a missing executable whose code the error inherits', async () => {
    await expect(runCli('gh', ['--version'], '/repository')).resolves.toMatchObject({
      code: 1,
      missing: true,
    })
  })
})
