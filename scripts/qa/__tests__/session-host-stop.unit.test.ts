import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalSessionHostPaths } from '../../../src/main/session-host/local-session-paths'
import {
  LocalSessionClientProtocolError,
  LocalSessionHostUpgradePendingError,
} from '../../../src/main/session-host/local-session-client-protocol-error'

const client = vi.hoisted(() => ({
  execute: vi.fn(),
  connect: vi.fn(),
}))

vi.mock('../../../src/main/session-host/local-session-client', () => ({
  executeLocalSessionCommand: client.execute,
}))
vi.mock('../../../src/main/session-host/local-session-client-connection', async (original) => ({
  ...(await original<object>()),
  openLocalSessionConnection: client.connect,
}))

const { requestStop } = await import('../session-host-stop')

const PATHS = {
  stateRoot: 'qa-profile/session-host',
  legacyDatabasePath: 'qa-profile/openwaggle.sqlite',
  databasePath: 'qa-profile/session-host/session-host.sqlite',
  recoveryDatabasePath: 'qa-profile/session-host/pre-cutover-openwaggle.sqlite',
  credentialPath: 'qa-profile/session-host/local-user.credential',
  endpoint: 'qa-profile/session-host/host.sock',
  endpointDirectory: 'qa-profile/session-host',
  endpointCapabilityPath: null,
} satisfies LocalSessionHostPaths

beforeEach(() => {
  client.execute.mockReset()
  client.connect.mockReset()
})

describe('the QA Session Host stop', () => {
  it('sends the update stop and returns the process id the Host names', async () => {
    client.execute.mockResolvedValue({
      contract: 'local-host-v1',
      response: { processId: 4242 },
    })

    await expect(requestStop(PATHS)).resolves.toBe(4242)
    expect(client.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        paths: PATHS,
        clientKind: 'internal',
        payload: expect.objectContaining({
          contract: 'local-host-v1',
          request: expect.objectContaining({ operation: 'stop', purpose: 'update' }),
        }),
      }),
    )
  })

  it('treats a Host already handing over as stopping, with no process to wait on', async () => {
    client.execute.mockRejectedValue(new LocalSessionHostUpgradePendingError('host-1', [], []))

    await expect(requestStop(PATHS)).resolves.toBeUndefined()
    expect(client.connect).not.toHaveBeenCalled()
  })

  it('drains a Host that refuses the update stop through the version handoff', async () => {
    client.execute.mockRejectedValue(
      new LocalSessionClientProtocolError('command_failed', 'unknown purpose'),
    )
    client.connect.mockRejectedValue(new LocalSessionHostUpgradePendingError('host-1', [], []))

    await expect(requestStop(PATHS)).resolves.toBeUndefined()
    expect(client.connect).toHaveBeenCalledOnce()
  })

  it('passes on a protocol failure other than a refused purpose', async () => {
    const failure = new LocalSessionClientProtocolError('unauthorized', 'not this client')
    client.execute.mockRejectedValue(failure)

    await expect(requestStop(PATHS)).rejects.toBe(failure)
    expect(client.connect).not.toHaveBeenCalled()
  })

  it('passes on any other failure', async () => {
    const failure = new Error('credential unreadable')
    client.execute.mockRejectedValue(failure)

    await expect(requestStop(PATHS)).rejects.toBe(failure)
  })
})
