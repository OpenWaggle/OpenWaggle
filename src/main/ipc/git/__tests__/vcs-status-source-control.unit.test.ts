import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openWorkingTreeMock } = vi.hoisted(() => ({ openWorkingTreeMock: vi.fn() }))

vi.mock('../../../services/source-control/working-tree-source-control', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openWorkingTreeSourceControl: openWorkingTreeMock,
}))

const { localSourceControlState, resolveOpenChangeRequest } = await import(
  '../vcs-status-source-control'
)

const REMOTE = { name: 'origin', url: 'git@git.acme.io:team/app.git' }
const REPOSITORY = { provider: 'gitlab', host: 'git.acme.io', owner: 'team', repository: 'app' }

describe('source-control part of the VCS status', () => {
  beforeEach(() => {
    openWorkingTreeMock.mockReset()
  })

  it('carries the repository web address for provider fallbacks', async () => {
    openWorkingTreeMock.mockResolvedValue({
      resolution: {
        kind: 'resolved',
        remote: REMOTE,
        repository: REPOSITORY,
        hostState: { host: 'git.acme.io', provider: 'gitlab', source: 'cli-sign-in' },
        attention: null,
      },
      sourceControl: null,
    })

    await expect(localSourceControlState('/work', REMOTE)).resolves.toMatchObject({
      sourceControlProvider: { id: 'gitlab', host: 'git.acme.io' },
      sourceControlRepositoryUrl: 'https://git.acme.io/team/app',
    })
  })

  it('keeps the local status when resolving the host fails', async () => {
    openWorkingTreeMock.mockRejectedValue(new Error('settings unavailable'))

    await expect(localSourceControlState('/work', REMOTE)).resolves.toEqual({
      sourceControlProvider: null,
      sourceControlHost: null,
      sourceControlAttention: null,
      sourceControlRepositoryUrl: null,
    })
  })

  it('keeps the remote status when resolving the host fails', async () => {
    openWorkingTreeMock.mockRejectedValue(new Error('settings unavailable'))

    await expect(resolveOpenChangeRequest('/work', 'feature', REMOTE)).resolves.toEqual({
      changeRequest: null,
      changeRequestAttention: null,
      changeRequestAccount: null,
    })
  })
})
