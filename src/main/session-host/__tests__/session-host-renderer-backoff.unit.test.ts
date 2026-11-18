import { describe, expect, it, vi } from 'vitest'
import { localSessionClientProtocolError } from '../local-session-client-protocol-error'
import type { LocalSessionWatchInput } from '../local-session-event-client'
import {
  type RemoteSessionHostRendererBridgeDependencies,
  runRemoteSessionHostRendererPump,
} from '../session-host-renderer-recovery'

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

function recoveryHandlers() {
  return { onSnapshot: vi.fn(), onResyncRequired: vi.fn(), onEvent: vi.fn() }
}

describe('remote Session Host renderer retry backoff', () => {
  it('retries persistent failures slowly after logging one error', async () => {
    const abortController = new AbortController()
    const recoveryLog = recoveryLogger()
    const watch = vi.fn(async () => {
      if (watch.mock.calls.length === 14) {
        abortController.abort()
        return { status: 'closed' as const }
      }
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    })
    const wait = vi.fn(async (_milliseconds: number) => undefined)

    await runRemoteSessionHostRendererPump({
      paths,
      clientVersion: 'test',
      dependencies: {
        watch,
        ensure: async () => undefined,
        refreshPaths: async (candidate) => candidate,
        wait,
        logger: recoveryLog,
      },
      signal: abortController.signal,
      handlers: recoveryHandlers(),
    })

    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([
      250, 500, 1_000, 2_000, 4_000, 4_000, 4_000, 4_000, 4_000, 30_000, 30_000, 30_000, 30_000,
    ])
    expect(recoveryLog.error).toHaveBeenCalledOnce()
    expect(recoveryLog.error).toHaveBeenCalledWith(
      'Remote Session Host renderer connection keeps failing; retrying slowly.',
      { attempt: 10, delayMs: 30_000, error: 'connection reset', suppressedWarnings: 1 },
    )
    expect(recoveryLog.warn.mock.calls.map(([, details]) => details.attempt)).toEqual([1, 2, 4, 8])
  })

  it('waits out an authentication throttle instead of retrying quickly', async () => {
    // An older Host reports its Host-wide throttle as a non-retryable authentication failure.
    const authenticationFailed = localSessionClientProtocolError(
      {
        kind: 'error',
        code: 'authentication_failed',
        message: 'Local Session authentication failed.',
        retryable: false,
      },
      'Local Session authentication failed.',
    )
    const throttled = localSessionClientProtocolError(
      {
        kind: 'error',
        code: 'authentication_throttled',
        message: 'Local Session authentication is temporarily throttled.',
        retryable: true,
      },
      'Local Session authentication failed.',
    )
    const abortController = new AbortController()
    const handlers = recoveryHandlers()
    const watch = vi.fn(async (input: LocalSessionWatchInput) => {
      if (watch.mock.calls.length === 1) throw authenticationFailed
      if (watch.mock.calls.length === 2) throw throttled
      await input.onSnapshot?.([])
      abortController.abort()
      return { status: 'closed' as const }
    })
    const ensure = vi
      .fn<() => Promise<undefined>>()
      .mockRejectedValueOnce(authenticationFailed)
      .mockRejectedValueOnce(throttled)
      .mockResolvedValue(undefined)
    const wait = vi.fn(async (_milliseconds: number) => undefined)

    await runRemoteSessionHostRendererPump({
      paths,
      clientVersion: 'test',
      dependencies: {
        watch,
        ensure,
        refreshPaths: async (candidate) => candidate,
        wait,
        logger: recoveryLogger(),
      },
      signal: abortController.signal,
      handlers,
    })

    // One quick retry for an authentication failure; a Host-wide throttle is waited out.
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([250, 30_000])
    expect(handlers.onSnapshot).toHaveBeenCalledOnce()
  })

  it('waits out an older Host throttle once a quick retry failed too', async () => {
    const authenticationFailed = localSessionClientProtocolError(
      {
        kind: 'error',
        code: 'authentication_failed',
        message: 'Local Session authentication failed.',
        retryable: false,
      },
      'Local Session authentication failed.',
    )
    const abortController = new AbortController()
    const handlers = recoveryHandlers()
    const watch = vi.fn(async (input: LocalSessionWatchInput) => {
      if (watch.mock.calls.length <= 2) throw authenticationFailed
      await input.onSnapshot?.([])
      abortController.abort()
      return { status: 'closed' as const }
    })
    const wait = vi.fn(async (_milliseconds: number) => undefined)

    await runRemoteSessionHostRendererPump({
      paths,
      clientVersion: 'test',
      dependencies: {
        watch,
        ensure: async () => undefined,
        refreshPaths: async (candidate) => candidate,
        wait,
        logger: recoveryLogger(),
      },
      signal: abortController.signal,
      handlers,
    })

    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([250, 30_000])
  })

  it('keeps backing off when every subscription fails right after its snapshot', async () => {
    const abortController = new AbortController()
    const watch = vi.fn(async (input: LocalSessionWatchInput) => {
      if (watch.mock.calls.length === 5) {
        abortController.abort()
        return { status: 'closed' as const }
      }
      await input.onSnapshot?.([])
      await input.onCursor?.({ hostInstanceId: 'host-current', sequence: 1 })
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    })
    const wait = vi.fn(async (_milliseconds: number) => undefined)

    await runRemoteSessionHostRendererPump({
      paths,
      clientVersion: 'test',
      dependencies: {
        watch,
        ensure: async () => undefined,
        refreshPaths: async (candidate) => candidate,
        wait,
        logger: recoveryLogger(),
      },
      signal: abortController.signal,
      handlers: recoveryHandlers(),
    })

    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([250, 500, 1_000, 2_000])
  })

  it('counts a subscription as recovered once it delivers past its snapshot or stays up', async () => {
    let clock = 0
    const abortController = new AbortController()
    const watch = vi.fn(async (input: LocalSessionWatchInput) => {
      const call = watch.mock.calls.length
      if (call === 7) {
        abortController.abort()
        return { status: 'closed' as const }
      }
      await input.onSnapshot?.([])
      await input.onCursor?.({ hostInstanceId: 'host-current', sequence: call })
      // Call 3 advances its cursor after subscribing; call 6 stays up for ten seconds.
      if (call === 3) await input.onCursor?.({ hostInstanceId: 'host-current', sequence: 100 })
      if (call === 6) clock += 10_000
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    })
    const wait = vi.fn(async (_milliseconds: number) => undefined)

    await runRemoteSessionHostRendererPump({
      paths,
      clientVersion: 'test',
      dependencies: {
        watch,
        ensure: async () => undefined,
        refreshPaths: async (candidate) => candidate,
        wait,
        logger: recoveryLogger(),
        now: () => clock,
      },
      signal: abortController.signal,
      handlers: recoveryHandlers(),
    })

    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([250, 500, 250, 500, 1_000, 250])
  })
})
