import { beforeEach, describe, expect, it, vi } from 'vitest'

const providerMocks = vi.hoisted(() => ({
  getSourceControlProvider: vi.fn(),
  resolvePrimaryRemote: vi.fn(),
}))

vi.mock('../../../adapters/source-control', () => ({
  getSourceControlProvider: providerMocks.getSourceControlProvider,
}))

vi.mock('../primary-remote', () => ({
  resolvePrimaryRemote: providerMocks.resolvePrimaryRemote,
  resolvePrimaryRemoteUrl: vi.fn(),
}))

const { resolveSourceControlProvider } = await import('../change-request-provider')

describe('change-request provider transport safety', () => {
  beforeEach(() => {
    providerMocks.getSourceControlProvider.mockReset()
    providerMocks.resolvePrimaryRemote.mockReset()
  })

  it('does not create hosted-provider authority from a local file transport', async () => {
    providerMocks.resolvePrimaryRemote.mockResolvedValue({
      name: 'origin',
      url: 'file://github.com/tmp/victim.git',
    })

    await expect(resolveSourceControlProvider('/repo')).resolves.toBeNull()
    expect(providerMocks.getSourceControlProvider).not.toHaveBeenCalled()
  })
})
