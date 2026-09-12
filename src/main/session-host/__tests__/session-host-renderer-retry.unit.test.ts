import { describe, expect, it, vi } from 'vitest'
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

describe('remote Session Host renderer retry loop', () => {
  it('keeps retrying recoverable Host failures after the former retry limit', async () => {
    const abortController = new AbortController()
    let watchCalls = 0
    const recoveryLog = recoveryLogger()
    const watch = vi.fn(async () => {
      watchCalls += 1
      if (watchCalls === 7) {
        abortController.abort()
        return { status: 'closed' as const }
      }
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
    })
    let ensureCalls = 0
    const ensure = vi.fn(async () => {
      ensureCalls += 1
      if (ensureCalls <= 5) {
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' })
      }
    })
    const wait = vi.fn(async (_milliseconds: number) => undefined)
    await runRemoteSessionHostRendererPump({
      paths,
      clientVersion: 'test',
      dependencies: { watch, ensure, wait, logger: recoveryLog },
      signal: abortController.signal,
      handlers: recoveryHandlers(),
    })

    expect(watch).toHaveBeenCalledTimes(7)
    expect(ensure).toHaveBeenCalledTimes(6)
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([250, 500, 1_000, 2_000, 4_000, 4_000])
    expect(recoveryLog.warn).toHaveBeenCalledTimes(6)
    expect(recoveryLog.error).not.toHaveBeenCalled()
  })

  it('recovers from an unclassified transient watch failure', async () => {
    const abortController = new AbortController()
    let watchCalls = 0
    const watch = vi.fn(async () => {
      watchCalls += 1
      if (watchCalls === 1) throw new Error('Timed out waiting for the Local Session Host.')
      abortController.abort()
      return { status: 'closed' as const }
    })
    const ensure = vi.fn(async () => undefined)
    const wait = vi.fn(async (_milliseconds: number) => undefined)
    await runRemoteSessionHostRendererPump({
      paths,
      clientVersion: 'test',
      dependencies: { watch, ensure, wait, logger: recoveryLogger() },
      signal: abortController.signal,
      handlers: recoveryHandlers(),
    })

    expect(watch).toHaveBeenCalledTimes(2)
    expect(ensure).toHaveBeenCalledOnce()
    expect(wait).toHaveBeenCalledWith(250, abortController.signal)
  })

  it('uses an abortable fallback delay when the configured retry wait rejects', async () => {
    vi.useFakeTimers()
    try {
      const abortController = new AbortController()
      let watchCalls = 0
      let reportDelayFailure: (() => void) | undefined
      const delayFailureReported = new Promise<void>((resolve) => {
        reportDelayFailure = resolve
      })
      const recoveryLog = recoveryLogger()
      recoveryLog.error.mockImplementation((message) => {
        if (message === 'Remote Session Host renderer recovery delay failed.') {
          reportDelayFailure?.()
        }
      })
      const watch = vi.fn(async () => {
        watchCalls += 1
        if (watchCalls === 1) {
          throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
        }
        abortController.abort()
        return { status: 'closed' as const }
      })
      const wait = vi.fn(async (_milliseconds: number) => {
        throw new Error('retry scheduler failed')
      })
      const pump = runRemoteSessionHostRendererPump({
        paths,
        clientVersion: 'test',
        dependencies: {
          watch,
          ensure: async () => undefined,
          wait,
          logger: recoveryLog,
        },
        signal: abortController.signal,
        handlers: recoveryHandlers(),
      })

      await delayFailureReported
      expect(watch).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(249)
      expect(watch).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1)
      await pump

      expect(watch).toHaveBeenCalledTimes(2)
      expect(recoveryLog.error).toHaveBeenCalledWith(
        'Remote Session Host renderer recovery delay failed.',
        { error: 'retry scheduler failed' },
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles immediately when stopped during the fallback retry delay', async () => {
    vi.useFakeTimers()
    try {
      const abortController = new AbortController()
      let reportDelayFailure: (() => void) | undefined
      const delayFailureReported = new Promise<void>((resolve) => {
        reportDelayFailure = resolve
      })
      const recoveryLog = recoveryLogger()
      recoveryLog.error.mockImplementation((message) => {
        if (message === 'Remote Session Host renderer recovery delay failed.') {
          reportDelayFailure?.()
        }
      })
      const watch = vi.fn(async () => {
        throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' })
      })
      const pump = runRemoteSessionHostRendererPump({
        paths,
        clientVersion: 'test',
        dependencies: {
          watch,
          ensure: async () => undefined,
          wait: async () => Promise.reject(new Error('retry scheduler failed')),
          logger: recoveryLog,
        },
        signal: abortController.signal,
        handlers: recoveryHandlers(),
      })

      await delayFailureReported
      abortController.abort()
      await pump

      expect(watch).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
