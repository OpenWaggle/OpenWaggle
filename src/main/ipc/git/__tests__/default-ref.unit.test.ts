import { beforeEach, describe, expect, it, vi } from 'vitest'

const runGitMock = vi.hoisted(() =>
  vi.fn(async (_path: string, _args: readonly string[]) => ({ code: 1, stdout: '', stderr: '' })),
)

vi.mock('../shared', () => ({ runGit: runGitMock }))

const { resolveDefaultRef } = await import('../default-ref')

describe('resolveDefaultRef', () => {
  beforeEach(() => runGitMock.mockReset())

  it('resolves the default branch from a selected non-origin remote', async () => {
    runGitMock.mockImplementation(async (_path, args) => {
      const command = args?.join(' ') ?? ''
      if (command === 'symbolic-ref --quiet --short refs/remotes/upstream/HEAD') {
        return { code: 0, stdout: 'upstream/develop\n', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'unexpected command' }
    })

    await expect(resolveDefaultRef('/repo', 'upstream')).resolves.toBe('develop')
  })

  it('asks the selected remote when its local HEAD symref is absent', async () => {
    runGitMock.mockImplementation(async (_path, args) => {
      const command = args?.join(' ') ?? ''
      if (command === 'remote') return { code: 0, stdout: 'upstream\n', stderr: '' }
      if (command === 'ls-remote --symref upstream HEAD') {
        return { code: 0, stdout: 'ref: refs/heads/trunk\tHEAD\n', stderr: '' }
      }
      return { code: 1, stdout: '', stderr: 'not available locally' }
    })

    await expect(resolveDefaultRef('/repo', 'upstream')).resolves.toBe('trunk')
  })
})
