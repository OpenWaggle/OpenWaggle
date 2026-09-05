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

  it('stops and logs a terminal Host recovery failure without retrying it', async () => {
    let reportTerminalFailure: (() => void) | undefined
    const terminalFailureReported = new Promise<void>((resolve) => {
      reportTerminalFailure = resolve
    })
    const recoveryError = localSessionClientProtocolError(
      {
        code: 'host_launch_not_permitted',
        message: 'Host launch is not permitted',
        retryable: false,
      },
      'Host launch is not permitted',
    )
    const recoveryLog = recoveryLogger()
    recoveryLog.error.mockImplementation(() => reportTerminalFailure?.())
    const watch = vi.fn(async () => {
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    })
    const ensure = vi.fn(async () => Promise.reject(recoveryError))
    const wait = vi.fn(async (_milliseconds: number) => undefined)
    const stop = startRemoteSessionHostRendererBridge(
      { paths, clientVersion: 'test' },
      { watch, ensure, wait, logger: recoveryLog },
    )

    await terminalFailureReported
    await stop()

    expect(watch).toHaveBeenCalledOnce()
    expect(ensure).toHaveBeenCalledOnce()
    expect(wait).not.toHaveBeenCalled()
    expect(recoveryLog.error).toHaveBeenCalledWith(
      'Remote Session Host renderer recovery stopped after a terminal failure.',
      { error: recoveryError.message },
    )
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
