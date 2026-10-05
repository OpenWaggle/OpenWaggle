import { describe, expect, it, vi } from 'vitest'
import { LOCAL_SESSION_CURRENT_REVISION } from '../../../shared/types/local-session-protocol'
import { localSessionClientProtocolError } from '../local-session-client-protocol-error'
import type { LocalSessionWatchInput, LocalSessionWatchResult } from '../local-session-event-client'
import type { RemoteSessionHostRendererBridgeDependencies } from '../session-host-renderer-bridge'

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
  endpointCapabilityPath: null,
}

function recoveryLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies RemoteSessionHostRendererBridgeDependencies['logger']
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
    const ensure = vi.fn(async (_input: { readonly signal?: AbortSignal }) => {
      reportEnsure?.()
    })
    const stop = startRemoteSessionHostRendererBridge(
      {
        paths,
        clientVersion: 'test',
      },
      { watch, ensure, wait: async () => undefined, logger: recoveryLogger() },
    )

    await ensured
    await stop()

    expect(watch).toHaveBeenCalledWith(
      expect.objectContaining({ supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION] }),
    )
    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({ supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION] }),
    )
    expect(ensure.mock.calls[0]?.[0].signal?.aborted).toBe(true)
  })

  it('cancels and settles recovery when stopped while Host ensure is pending', async () => {
    let reportEnsureStarted: (() => void) | undefined
    const ensureStarted = new Promise<void>((resolve) => {
      reportEnsureStarted = resolve
    })
    let ensureSignal: AbortSignal | undefined
    const watch = vi.fn(async () => {
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    })
    const ensure = vi.fn(async (input: { readonly signal?: AbortSignal }) => {
      ensureSignal = input.signal
      reportEnsureStarted?.()
      return new Promise<never>(() => {})
    })
    const wait = vi.fn(async (_milliseconds: number) => undefined)
    const stop = startRemoteSessionHostRendererBridge(
      { paths, clientVersion: 'test' },
      { watch, ensure, wait, logger: recoveryLogger() },
    )

    await ensureStarted
    await stop()

    expect(ensureSignal?.aborted).toBe(true)
    expect(watch).toHaveBeenCalledOnce()
    expect(ensure).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
  })

  it('keeps recovering when Host ensure fails with a non-retryable handshake timeout', async () => {
    // An older Host that outlived a GUI update reports a handshake timeout under load as
    // non-retryable. Stopping on it left every Session without live events until a restart.
    const handshakeTimeout = localSessionClientProtocolError(
      {
        kind: 'error',
        code: 'handshake_timeout',
        message: 'Local Session handshake timed out.',
        retryable: false,
      },
      'Local Session authentication failed.',
    )
    let reportResubscribed: (() => void) | undefined
    const resubscribed = new Promise<void>((resolve) => {
      reportResubscribed = resolve
    })
    const recoveryLog = recoveryLogger()
    const watch = vi.fn(async (input: LocalSessionWatchInput): Promise<LocalSessionWatchResult> => {
      if (watch.mock.calls.length <= 3) {
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      }
      await input.onSnapshot?.([])
      reportResubscribed?.()
      return new Promise<LocalSessionWatchResult>(() => {})
    })
    const ensure = vi
      .fn<() => Promise<undefined>>()
      .mockRejectedValueOnce(handshakeTimeout)
      .mockRejectedValueOnce(handshakeTimeout)
      .mockResolvedValue(undefined)
    const wait = vi.fn(async (_milliseconds: number) => undefined)
    const stop = startRemoteSessionHostRendererBridge(
      { paths, clientVersion: 'test' },
      { watch, ensure, wait, logger: recoveryLog },
    )

    await resubscribed
    await stop()

    expect(watch).toHaveBeenCalledTimes(4)
    expect(ensure).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([250, 500, 1_000])
    expect(recoveryLog.warn).toHaveBeenCalledWith(
      'Remote Session Host renderer connection is degraded; retrying.',
      { attempt: 1, delayMs: 250, error: handshakeTimeout.message },
    )
    expect(recoveryLog.error).not.toHaveBeenCalled()
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
      {
        watch,
        ensure: async () => undefined,
        wait: async () => undefined,
        logger: recoveryLogger(),
      },
    )

    await snapshotEstablished
    await stop()

    expect(watch).toHaveBeenCalledTimes(2)
    expect(watch.mock.calls[1]?.[0].after).toBeUndefined()
    expect(broadcastToWindowsMock).toHaveBeenCalledWith('session-host:resync-required', {
      reason: 'cursor-expired',
    })
  })
})
