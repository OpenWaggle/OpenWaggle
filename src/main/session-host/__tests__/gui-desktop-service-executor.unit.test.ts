import type { DesktopFenceRecord } from '@shared/types/desktop-service'
import { fromAny } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  activeFence,
  browserCommand,
  browserStatus,
  envelope,
  executorHarness,
} from './gui-desktop-service-executor.test-harness'

afterEach(() => vi.useRealTimers())
const releasedFence: DesktopFenceRecord = { ...activeFence, state: 'released' }

describe('GUI desktop executor ownership and durable fences', () => {
  it('rejects stale leases and deadlines without invoking native services', async () => {
    const instance = executorHarness()
    expect(await instance.executor.execute(envelope(), 'wrong')).toMatchObject({
      outcome: 'failure',
    })
    expect(
      await instance.executor.execute({ ...envelope(), deadline: Date.now() }, 'lease-one'),
    ).toMatchObject({ outcome: 'failure' })
    expect(instance.status).not.toHaveBeenCalled()
  })

  it('rejects malformed commands with a fixed diagnostic that excludes payload content', async () => {
    const instance = executorHarness()
    const result = await instance.executor.execute(
      envelope(fromAny({ ...browserCommand, credential: 'do-not-log-this' })),
      'lease-one',
    )
    expect(result).toMatchObject({
      outcome: 'failure',
      message: 'The desktop command did not match the supported schema.',
    })
    expect(JSON.stringify(result)).not.toContain('do-not-log-this')
    expect(instance.status).not.toHaveBeenCalled()
  })

  it('does not replay a completed command identity', async () => {
    const instance = executorHarness()
    expect(await instance.executor.execute(envelope(), 'lease-one')).toMatchObject({
      outcome: 'success',
    })
    expect(await instance.executor.execute(envelope(), 'lease-one')).toMatchObject({
      outcome: 'failure',
    })
    expect(instance.status).toHaveBeenCalledOnce()
  })

  it('waits for actual native fence admission before acknowledging acquisition', async () => {
    const gate = Promise.withResolvers<void>()
    const instance = executorHarness({ acquireGate: Effect.promise(() => gate.promise) })
    let reconciled = false
    const pending = instance.executor.reconcile([activeFence]).then((value) => {
      reconciled = true
      return value
    })
    await vi.waitFor(() => expect(instance.nativeEvents).toHaveLength(0))
    expect(reconciled).toBe(false)
    gate.resolve()
    expect(await pending).toEqual({ released: [], activeTokens: [activeFence.token] })
    expect(instance.nativeActive.size).toBe(1)
    expect(
      await instance.executor.execute(
        envelope({ service: 'fence', operation: 'acquire', record: activeFence }),
        'lease-one',
      ),
    ).toMatchObject({ outcome: 'success' })
    await instance.executor.reconcile([releasedFence])
    expect(instance.nativeActive.size).toBe(0)
  })

  it('refuses acquisition acknowledgment for a record absent from the reconciled journal', async () => {
    const instance = executorHarness()
    expect(
      await instance.executor.execute(
        envelope({ service: 'fence', operation: 'acquire', record: activeFence }),
        'lease-one',
      ),
    ).toMatchObject({ outcome: 'failure' })
    expect(instance.nativeActive.size).toBe(0)
  })

  it('does not treat cancellation, expiry, or a missing journal record as release proof', async () => {
    vi.useFakeTimers()
    const instance = executorHarness()
    await instance.executor.reconcile([activeFence])
    instance.executor.cancelCommands()
    await vi.advanceTimersByTimeAsync(120_000)
    await expect(instance.executor.reconcile([])).rejects.toThrow('missing from the Host journal')
    expect(instance.nativeActive.size).toBe(1)
    await instance.executor.reconcile([releasedFence])
    expect(instance.nativeActive.size).toBe(0)
  })

  it.each([
    { hostInstanceId: 'host-other' },
    { scope: { kind: 'owner' as const, ownerKey: 'session-other' } },
  ])('rejects a release with changed identity %#', async (change) => {
    const instance = executorHarness()
    await instance.executor.reconcile([activeFence])
    await expect(instance.executor.reconcile([{ ...releasedFence, ...change }])).rejects.toThrow(
      'identity changed',
    )
    expect(instance.nativeActive.size).toBe(1)
    await instance.executor.reconcile([releasedFence])
  })

  it('fails attachment when the actual terminal fence cannot be acquired', async () => {
    const instance = executorHarness({
      acquireGate: Effect.fail(new Error('native admission rejected')),
    })
    await expect(instance.executor.reconcile([activeFence])).rejects.toThrow(
      'native admission rejected',
    )
    expect(instance.nativeActive.size).toBe(0)
    expect(
      await instance.executor.execute(
        envelope({ service: 'fence', operation: 'acquire', record: activeFence }),
        'lease-one',
      ),
    ).toMatchObject({ outcome: 'failure' })
  })

  it.each([
    activeFence,
    { ...activeFence, scope: { kind: 'path' as const, directoryPath: '/repo' } },
  ])('rejects new browser work touching a held native fence %#', async (fence) => {
    const instance = executorHarness()
    await instance.executor.reconcile([fence])
    try {
      const result = await instance.executor.execute(envelope(), 'lease-one')
      expect(result).toMatchObject({ outcome: 'failure' })
      expect(instance.status).not.toHaveBeenCalled()
    } finally {
      await instance.executor.reconcile([{ ...fence, state: 'released' }])
    }
  })

  it('lets browser work for an unrelated owner proceed while another owner is fenced', async () => {
    const instance = executorHarness()
    await instance.executor.reconcile([
      { ...activeFence, scope: { kind: 'owner', ownerKey: 'session-other' } },
    ])
    expect(await instance.executor.execute(envelope(), 'lease-one')).toMatchObject({
      outcome: 'success',
    })
    await instance.executor.reconcile([
      { ...releasedFence, scope: { kind: 'owner', ownerKey: 'session-other' } },
    ])
  })

  it('drains already running browser work before acknowledging the matching cleanup fence', async () => {
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const status = vi.fn(() =>
      Effect.promise(async () => {
        started.resolve()
        await finish.promise
        return browserStatus
      }),
    )
    const instance = executorHarness({ browser: { status } })
    const running = instance.executor.execute(envelope(), 'lease-one')
    await started.promise
    let reconciled = false
    const reconciliation = instance.executor.reconcile([activeFence]).then(() => {
      reconciled = true
    })
    try {
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(reconciled).toBe(false)
    } finally {
      finish.resolve()
      await running
      await reconciliation
      await instance.executor.reconcile([releasedFence])
    }
  })

  it('propagates cancellation to native browser work without reporting a definite failure', async () => {
    const started = Promise.withResolvers<void>()
    const interrupted = vi.fn()
    const instance = executorHarness({
      browser: {
        status: () =>
          Effect.sync(() => started.resolve()).pipe(
            Effect.zipRight(Effect.never),
            Effect.onInterrupt(() => Effect.sync(interrupted)),
          ),
      },
    })
    const running = instance.executor.execute(envelope(), 'lease-one')
    await started.promise
    expect(instance.executor.isIdle()).toBe(false)
    instance.executor.cancel('command-one')
    expect(await running).toMatchObject({ outcome: 'failure', uncertain: true })
    expect(interrupted).toHaveBeenCalledOnce()
    expect(instance.executor.isIdle()).toBe(true)
  })

  it('retains failed browser release as uncertainty instead of acknowledging a released receipt', async () => {
    const releaseBrowser = vi.fn(() => {
      throw new Error('browser release failed')
    })
    const instance = executorHarness({ releaseBrowser })
    await instance.executor.reconcile([activeFence])
    await expect(instance.executor.reconcile([releasedFence])).rejects.toThrow(
      'browser release failed',
    )
    expect(releaseBrowser).toHaveBeenCalledOnce()
    expect(instance.executor.hasActiveFences()).toBe(true)
    expect(await instance.executor.execute(envelope(), 'lease-one')).toMatchObject({
      outcome: 'failure',
    })
    await expect(instance.executor.reconcile([releasedFence])).rejects.toThrow(
      'browser release failed',
    )
  })
})
