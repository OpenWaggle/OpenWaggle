import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../local-session-client', () => ({
  executeLocalSessionCommand: vi.fn(),
  LocalSessionHostUpgradePendingError: class extends Error {},
  probeLocalSessionHost: vi.fn(),
}))
vi.mock('../local-session-paths', () => ({
  refreshLocalSessionHostEndpoint: async (paths: unknown) => paths,
}))

const { executeLocalSessionCommand } = await import('../local-session-client')
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
      .mockRejectedValueOnce(new Error('Invalid request'))
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
})
