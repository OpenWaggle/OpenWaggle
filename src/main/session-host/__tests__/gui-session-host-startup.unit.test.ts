import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prepareLocalSessionHostPathsMock, startupMarkMock } = vi.hoisted(() => ({
  prepareLocalSessionHostPathsMock: vi.fn(async (paths: object) => paths),
  startupMarkMock: vi.fn(),
}))

vi.mock('../local-session-paths', () => ({
  prepareLocalSessionHostPaths: prepareLocalSessionHostPathsMock,
  resolveLocalSessionHostPaths: () => ({
    endpoint: '/tmp/openwaggle.sock',
    legacyDatabasePath: '/tmp/legacy.db',
    databasePath: '/tmp/session-host.db',
    recoveryDatabasePath: '/tmp/recovery.db',
    endpointCapabilityPath: null,
  }),
}))
vi.mock('../session-host-cutover', () => ({
  runSessionHostCutover: vi.fn(async () => undefined),
  sessionHostTargetExists: vi.fn(async () => true),
}))

import { prepareGuiSessionHostStartup } from '../gui-session-host-startup'

describe('GUI Session Host startup', () => {
  beforeEach(() => {
    prepareLocalSessionHostPathsMock.mockClear()
    startupMarkMock.mockClear()
  })

  it('always reserves canonical store ownership for the detached Host', async () => {
    const startup = await prepareGuiSessionHostStartup({
      userDataRoot: '/tmp/openwaggle-test',
      startupMark: startupMarkMock,
    })

    expect(prepareLocalSessionHostPathsMock).toHaveBeenCalledOnce()
    expect(startupMarkMock).toHaveBeenCalledWith('session-host-paths-ready')
    expect(startup).toEqual({
      paths: expect.objectContaining({
        endpoint: '/tmp/openwaggle.sock',
        databasePath: '/tmp/session-host.db',
      }),
    })
  })
})
