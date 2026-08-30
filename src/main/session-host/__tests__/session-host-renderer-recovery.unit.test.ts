import { describe, expect, it, vi } from 'vitest'
import type { LocalSessionWatchInput, LocalSessionWatchResult } from '../local-session-event-client'

const { broadcastToWindowsMock } = vi.hoisted(() => ({
  broadcastToWindowsMock: vi.fn(),
}))

vi.mock('../../utils/broadcast', () => ({
  broadcastToWindows: broadcastToWindowsMock,
}))

import { startRemoteSessionHostRendererBridge } from '../session-host-renderer-bridge'

const paths = {
  stateRoot: '/state',
  legacyDatabasePath: '/state/legacy.sqlite',
  databasePath: '/state/host.sqlite',
  recoveryDatabasePath: '/state/recovery.sqlite',
  credentialPath: '/state/credential',
  endpoint: '/state/host.sock',
  endpointDirectory: '/state',
}

describe('remote Session Host renderer recovery', () => {
  it('reacquires a crashed detached Host before reconnecting the event stream', async () => {
    let reportEnsure: (() => void) | undefined
    const ensured = new Promise<void>((resolve) => {
      reportEnsure = resolve
    })
    const watch = vi.fn(async () => {
      const error = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      throw error
    })
    const ensure = vi.fn(async () => {
      reportEnsure?.()
    })
    const stop = startRemoteSessionHostRendererBridge(
      {
        paths,
        clientVersion: 'test',
      },
      { watch, ensure, wait: async () => undefined },
    )

    await ensured
    stop()

    expect(watch).toHaveBeenCalled()
    expect(ensure).toHaveBeenCalled()
  })

  it('waits for a replacement snapshot subscription before asking the renderer to resync', async () => {
    let watchCalls = 0
    let reportSnapshot: (() => void) | undefined
    const snapshotEstablished = new Promise<void>((resolve) => {
      reportSnapshot = resolve
    })
    const watch = vi.fn(async (input: LocalSessionWatchInput): Promise<LocalSessionWatchResult> => {
      watchCalls += 1
      if (watchCalls === 1) {
        return {
          status: 'resync-required',
          reason: 'cursor-expired',
          cursor: { hostInstanceId: 'host-next', sequence: 12 },
        }
      }
      expect(broadcastToWindowsMock).not.toHaveBeenCalledWith(
        'session-host:resync-required',
        expect.anything(),
      )
      await input.onSnapshot?.([])
      reportSnapshot?.()
      return new Promise<LocalSessionWatchResult>(() => {})
    })
    const stop = startRemoteSessionHostRendererBridge(
      { paths, clientVersion: 'test' },
      { watch, ensure: async () => undefined, wait: async () => undefined },
    )

    await snapshotEstablished
    stop()

    expect(watch).toHaveBeenCalledTimes(2)
    expect(watch.mock.calls[1]?.[0].after).toBeUndefined()
    expect(broadcastToWindowsMock).toHaveBeenCalledWith('session-host:resync-required', {
      reason: 'cursor-expired',
    })
  })
})
