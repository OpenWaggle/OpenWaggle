import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  acquireSessionHostOwnershipMock,
  prepareLocalSessionHostPathsMock,
  probeLocalSessionHostMock,
  releaseOwnershipMock,
  runSessionHostCutoverMock,
  sessionHostTargetExistsMock,
  withLegacySessionWriterFenceMock,
} = vi.hoisted(() => ({
  acquireSessionHostOwnershipMock: vi.fn(),
  prepareLocalSessionHostPathsMock: vi.fn(async () => undefined),
  probeLocalSessionHostMock: vi.fn(async () => undefined),
  releaseOwnershipMock: vi.fn(async () => undefined),
  runSessionHostCutoverMock: vi.fn(async () => undefined),
  sessionHostTargetExistsMock: vi.fn(async () => true),
  withLegacySessionWriterFenceMock: vi.fn((operation: () => Promise<unknown>) => operation()),
}))

vi.mock('../legacy-session-writer-fence', () => ({
  withLegacySessionWriterFence: withLegacySessionWriterFenceMock,
}))
vi.mock('../local-session-client', () => ({
  LocalSessionHostUpgradePendingError: class extends Error {},
  probeLocalSessionHost: probeLocalSessionHostMock,
}))
vi.mock('../local-session-host-launcher', () => ({
  isLocalSessionHostUnavailable: (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error,
}))
vi.mock('../local-session-paths', () => ({
  prepareLocalSessionHostPaths: prepareLocalSessionHostPathsMock,
  resolveLocalSessionHostPaths: () => ({
    endpoint: '/tmp/openwaggle.sock',
    legacyDatabasePath: '/tmp/legacy.db',
    databasePath: '/tmp/session-host.db',
    recoveryDatabasePath: '/tmp/recovery.db',
  }),
}))
vi.mock('../session-host-cutover', () => ({
  runSessionHostCutover: runSessionHostCutoverMock,
  sessionHostTargetExists: sessionHostTargetExistsMock,
}))
vi.mock('../session-host-ownership', () => ({
  acquireSessionHostOwnership: acquireSessionHostOwnershipMock,
}))

import { prepareGuiSessionHostStartup } from '../gui-session-host-startup'

describe('GUI Session Host startup election', () => {
  beforeEach(() => {
    acquireSessionHostOwnershipMock.mockReset().mockResolvedValue({
      targetPath: '/tmp/session-host.db',
      release: releaseOwnershipMock,
    })
    prepareLocalSessionHostPathsMock.mockClear()
    probeLocalSessionHostMock.mockReset().mockResolvedValue(undefined)
    releaseOwnershipMock.mockReset()
    runSessionHostCutoverMock.mockReset().mockResolvedValue(undefined)
    sessionHostTargetExistsMock.mockReset().mockResolvedValue(true)
    withLegacySessionWriterFenceMock.mockClear()
  })

  it('takes ownership before preparing an absent target store', async () => {
    sessionHostTargetExistsMock.mockResolvedValue(false)
    probeLocalSessionHostMock.mockRejectedValue(
      Object.assign(new Error('missing socket'), { code: 'ENOENT' }),
    )

    const startup = await prepareGuiSessionHostStartup({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    expect(acquireSessionHostOwnershipMock).toHaveBeenCalledBefore(sessionHostTargetExistsMock)
    expect(withLegacySessionWriterFenceMock).toHaveBeenCalledOnce()
    expect(runSessionHostCutoverMock).toHaveBeenCalledOnce()
    expect(startup.databaseAccess).toBe('owner')
    await startup.ownership.release()
  })

  it('chooses the compatible Host that appears while ownership stays locked', async () => {
    probeLocalSessionHostMock
      .mockRejectedValueOnce(Object.assign(new Error('missing socket'), { code: 'ENOENT' }))
      .mockResolvedValue(undefined)
    acquireSessionHostOwnershipMock.mockRejectedValueOnce(
      Object.assign(new Error('owned'), { code: 'ELOCKED' }),
    )

    const startup = await prepareGuiSessionHostStartup({
      userDataRoot: '/tmp/openwaggle-test',
      clientVersion: 'test',
      startupMark: vi.fn(),
    })

    expect(probeLocalSessionHostMock).toHaveBeenCalledTimes(2)
    expect(runSessionHostCutoverMock).not.toHaveBeenCalled()
    expect(releaseOwnershipMock).not.toHaveBeenCalled()
    expect(startup.databaseAccess).toBe('client-read-only')
    await startup.ownership.release()
  })
})
