import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  watchEvents: vi.fn(async () => ({ status: 'closed' as const })),
}))

vi.mock('../session-host/local-session-client', () => ({
  watchLocalSessionEvents: mocks.watchEvents,
}))

import { watchSessionExportOperations } from '../sessions-cli-export-operation'

describe('Sessions CLI export operation watch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters the subscription inside the Host before subscriber capacity is charged', async () => {
    await expect(
      watchSessionExportOperations(
        {
          positionals: ['export', 'session-target', 'operation-target'],
          passthrough: [],
          options: new Map(),
        },
        {
          paths: {
            stateRoot: '/state',
            legacyDatabasePath: '/state/legacy.sqlite',
            databasePath: '/state/session-host.sqlite',
            recoveryDatabasePath: '/state/recovery.sqlite',
            credentialPath: '/state/local-user.credential',
            endpoint: '/state/host.sock',
            endpointDirectory: '/state',
            endpointCapabilityPath: null,
          },
          clientKind: 'cli',
          clientVersion: 'test',
          workingDirectory: '/project',
        },
      ),
    ).resolves.toEqual({ status: 'closed' })

    expect(mocks.watchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ sessionIds: ['session-target'] }),
    )
  })
})
