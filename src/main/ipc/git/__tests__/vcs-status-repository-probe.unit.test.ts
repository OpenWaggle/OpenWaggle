import { beforeEach, describe, expect, it, vi } from 'vitest'

const runGitMock = vi.hoisted(() => vi.fn())

vi.mock('../shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared')>()),
  runGit: runGitMock,
}))

const { getLocalVcsStatus } = await import('../vcs-status-service')

describe('VCS status repository probe', () => {
  beforeEach(() => runGitMock.mockReset())

  it('stops after one normal non-repository result', async () => {
    runGitMock.mockResolvedValue({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    })

    await expect(getLocalVcsStatus('/repo')).resolves.toEqual({
      ok: false,
      code: 'not-a-repo',
      message: 'Selected folder is not a Git repository.',
    })
    expect(runGitMock).toHaveBeenCalledOnce()
  })

  it('preserves a probe execution failure as retryable', async () => {
    runGitMock.mockResolvedValue({
      code: 1,
      stdout: '',
      stderr: 'spawn git EAGAIN',
      executionFailed: true,
    })

    await expect(getLocalVcsStatus('/repo')).resolves.toEqual({
      ok: false,
      code: 'unknown',
      message: 'Could not inspect the Git repository: spawn git EAGAIN',
    })
    expect(runGitMock).toHaveBeenCalledOnce()
  })
})
