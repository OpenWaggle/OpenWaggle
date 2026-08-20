import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliResult } from '../cli-runner'
import { getSourceControlProvider } from '../index'

const { runCliMock } = vi.hoisted(() => ({
  runCliMock: vi.fn(),
}))

vi.mock('../cli-runner', () => ({ runCli: runCliMock }))

function cli(partial: Partial<CliResult>): CliResult {
  return { stdout: '', stderr: '', code: 0, missing: false, ...partial }
}

describe('source control provider selection', () => {
  it('selects gh/glab adapters by id', () => {
    expect(getSourceControlProvider('github')?.id).toBe('github')
    expect(getSourceControlProvider('gitlab')?.id).toBe('gitlab')
    expect(getSourceControlProvider(null)).toBeNull()
  })
})

describe('github adapter typed failures (never throws)', () => {
  beforeEach(() => runCliMock.mockReset())

  it('returns cli-missing when gh is not installed', async () => {
    runCliMock.mockResolvedValue(cli({ missing: true, code: 1 }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.authStatus('/repo')).resolves.toEqual({
      ok: false,
      code: 'cli-missing',
      message: 'GitHub CLI (gh) is not installed.',
    })
  })

  it('returns not-authenticated when a PR command fails with auth error', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'authentication required' }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toMatchObject({
      ok: false,
      code: 'not-authenticated',
    })
  })

  it('parses a resolved PR into a typed change request', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify({
          title: 'T',
          url: 'https://github.com/o/r/pull/1',
          baseRefName: 'main',
          headRefName: 'feat',
          state: 'OPEN',
          isDraft: false,
        }),
      }),
    )
    const provider = getSourceControlProvider('github')
    await expect(provider?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toEqual({
      ok: true,
      changeRequest: {
        title: 'T',
        url: 'https://github.com/o/r/pull/1',
        baseRef: 'main',
        headRef: 'feat',
        state: 'open',
      },
    })
  })

  it('maps a not-found PR to a friendly no-change-request failure', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'no pull requests found for branch feat' }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.resolveChangeRequestForRef('/repo', 'feat')).resolves.toMatchObject({
      ok: false,
      code: 'no-change-request',
    })
  })

  it('skips invalid entries when listing pull requests', async () => {
    runCliMock.mockResolvedValue(
      cli({
        stdout: JSON.stringify([
          {
            title: 'Valid',
            url: 'https://x/1',
            baseRefName: 'main',
            headRefName: 'a',
            state: 'OPEN',
          },
          { title: 'no url' },
          null,
        ]),
      }),
    )
    const provider = getSourceControlProvider('github')
    const result = await provider?.listChangeRequests('/repo')
    expect(result).toMatchObject({ ok: true })
    if (result?.ok) expect(result.changeRequests).toHaveLength(1)
  })

  it('checks a change request out by reference', async () => {
    runCliMock.mockResolvedValue(cli({ stdout: '' }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.checkoutChangeRequest('/repo', '42')).resolves.toEqual({
      ok: true,
      reference: '42',
    })
    expect(runCliMock).toHaveBeenCalledWith('gh', ['pr', 'checkout', '42'], '/repo')
  })

  it('maps a failed checkout to a typed failure', async () => {
    runCliMock.mockResolvedValue(cli({ code: 1, stderr: 'could not find pull request' }))
    const provider = getSourceControlProvider('github')
    await expect(provider?.checkoutChangeRequest('/repo', '999')).resolves.toMatchObject({
      ok: false,
    })
  })
})
