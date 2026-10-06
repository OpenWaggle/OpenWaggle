import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../local-session-client', async () => ({
  executeLocalSessionCommand: vi.fn(),
  LocalSessionHostUpgradePendingError: (await import('../local-session-client-connection'))
    .LocalSessionHostUpgradePendingError,
  probeLocalSessionHost: vi.fn(),
}))
vi.mock('../local-session-paths', () => ({
  refreshLocalSessionHostEndpoint: async (paths: unknown) => paths,
}))

const { executeLocalSessionCommand, LocalSessionHostUpgradePendingError } = await import(
  '../local-session-client'
)
const { LocalSessionClientProtocolError } = await import('../local-session-client-protocol-error')
const { defaultReleaseDependencies } = await import('../session-host-update-release')

const stopped = (processId?: number): LocalSessionCommandResult =>
  fromPartial({
    contract: 'local-host-v1',
    response: { hostInstanceId: 'host-1', ...(processId ? { processId } : {}) },
  })

function sentPurposes() {
  return vi
    .mocked(executeLocalSessionCommand)
    .mock.calls.map(([input]) =>
      input.payload.contract === 'local-host-v1' ? input.payload.request.purpose : 'other',
    )
}

describe('the update stop request', () => {
  const client = fromPartial<Parameters<typeof defaultReleaseDependencies>[0]>({
    clientKind: 'cli',
    clientVersion: 'test',
  })

  it('asks for an update stop and returns the process to wait for', async () => {
    vi.mocked(executeLocalSessionCommand).mockReset().mockResolvedValueOnce(stopped(4242))

    await expect(defaultReleaseDependencies(client).requestStop()).resolves.toEqual({
      hostInstanceId: 'host-1',
      processId: 4242,
    })
    expect(sentPurposes()).toEqual(['update'])
  })

  it('stops an older Host that rejects the update purpose with a plain stop', async () => {
    vi.mocked(executeLocalSessionCommand)
      .mockReset()
      // How beta.9 answers a field its exact decoder does not know.
      .mockRejectedValueOnce(
        new LocalSessionClientProtocolError('command_failed', 'Expected never'),
      )
      .mockResolvedValueOnce(stopped())

    await expect(defaultReleaseDependencies(client).requestStop()).resolves.toEqual({
      hostInstanceId: 'host-1',
    })
    expect(sentPurposes()).toEqual(['update', undefined])
  })

  it('does not retry when no Host is running', async () => {
    vi.mocked(executeLocalSessionCommand)
      .mockReset()
      .mockRejectedValueOnce(Object.assign(new Error('gone'), { code: 'ECONNREFUSED' }))

    await expect(defaultReleaseDependencies(client).requestStop()).rejects.toThrow('gone')
    expect(sentPurposes()).toEqual(['update'])
  })

  it('does not retry a stop the Host refused for another reason', async () => {
    vi.mocked(executeLocalSessionCommand)
      .mockReset()
      .mockRejectedValueOnce(new LocalSessionClientProtocolError('host_draining', 'Stopping'))

    await expect(defaultReleaseDependencies(client).requestStop()).rejects.toThrow('Stopping')
    expect(sentPurposes()).toEqual(['update'])
  })

  it('waits for an older Host that is already handing over', async () => {
    vi.mocked(executeLocalSessionCommand)
      .mockReset()
      .mockRejectedValueOnce(new LocalSessionHostUpgradePendingError('host-old', [], []))

    await expect(defaultReleaseDependencies(client).requestStop()).resolves.toEqual({
      hostInstanceId: 'host-old',
    })
  })
})
