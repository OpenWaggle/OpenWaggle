import type { DesktopFenceRecord } from '@shared/types/desktop-service'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brokerHarness } from '../../application/__tests__/desktop-service-broker.test-harness'
import { startGuiDesktopServiceBridge } from '../gui-desktop-service-bridge'
import type { GuiDesktopServiceExecutor } from '../gui-desktop-service-executor'
import type { LocalSessionHostPaths } from '../local-session-paths'

vi.mock('../local-session-client', () => ({ executeLocalSessionCommand: vi.fn() }))
vi.mock('../local-session-paths', () => ({ refreshLocalSessionHostEndpoint: vi.fn() }))
vi.mock('../../logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('real desktop broker and GUI bridge shutdown', () => {
  it('settles idle long polls before the 10 second Electron quit budget and releases ownership', async () => {
    const instance = brokerHarness()
    let polls = 0
    const executor = fromPartial<GuiDesktopServiceExecutor>({
      guiInstanceId: '00000000-0000-4000-8000-000000000001',
      reconcile: async () => ({ released: [], activeTokens: [] }),
      isIdle: () => true,
      hasActiveFences: () => false,
      cancelCommands: vi.fn(),
    })
    const bridge = await startGuiDesktopServiceBridge({
      client: { paths: fromPartial<LocalSessionHostPaths>({}), clientVersion: 'test' },
      executor,
      request: (request) => {
        if (request.operation === 'poll') polls += 1
        return Effect.runPromise(instance.broker.handleGuiRequest(request))
      },
    })
    await vi.advanceTimersByTimeAsync(4999)
    expect(polls).toBe(1)
    let settled = false
    const startedAt = Date.now()
    let stoppedAt = startedAt
    const stopping = bridge.stop().then(() => {
      settled = true
      stoppedAt = Date.now()
    })
    try {
      await vi.advanceTimersByTimeAsync(9999)
      expect(settled).toBe(true)
      expect(stoppedAt - startedAt).toBeLessThanOrEqual(500)
      expect(polls).toBeLessThanOrEqual(6)
      await stopping
      await bridge.markClosed()
      const next = await instance.register('new-gui-after-clean-quit')
      expect(next.operation).toBe('register')
    } finally {
      await vi.advanceTimersByTimeAsync(30_000)
      await stopping
      instance.broker.close()
    }
  })

  it('keeps active fences held while draining polls are paced and waits for actual release', async () => {
    const record: DesktopFenceRecord = {
      token: 'active-mutation',
      hostInstanceId: 'host-one',
      scope: { kind: 'owner', ownerKey: 'session-one' },
      state: 'active',
    }
    const instance = brokerHarness([record])
    let active = true
    let polls = 0
    const executor = fromPartial<GuiDesktopServiceExecutor>({
      guiInstanceId: '00000000-0000-4000-8000-000000000001',
      reconcile: async (fences: readonly DesktopFenceRecord[]) => {
        const activeTokens = fences
          .filter((fence) => fence.state === 'active')
          .map((fence) => fence.token)
        active = activeTokens.length > 0
        return { activeTokens, released: fences.filter((fence) => fence.state === 'released') }
      },
      isIdle: () => true,
      hasActiveFences: () => active,
      cancelCommands: vi.fn(),
    })
    const bridge = await startGuiDesktopServiceBridge({
      client: { paths: fromPartial<LocalSessionHostPaths>({}), clientVersion: 'test' },
      executor,
      request: (request) => {
        if (request.operation === 'poll') polls += 1
        return Effect.runPromise(instance.broker.handleGuiRequest(request))
      },
    })
    let settled = false
    const stopping = bridge.stop().then(() => {
      settled = true
    })
    try {
      await vi.advanceTimersByTimeAsync(1000)
      expect(polls).toBeGreaterThanOrEqual(5)
      expect(polls).toBeLessThanOrEqual(12)
      expect(settled).toBe(false)
      expect(instance.records.get(record.token)?.state).toBe('active')
      await expect(bridge.markClosed()).rejects.toThrow('must drain')
      await Effect.runPromise(instance.repository.markReleased(record.token, record.hostInstanceId))
      await vi.advanceTimersByTimeAsync(500)
      expect(settled).toBe(true)
      await stopping
      await bridge.markClosed()
      expect(instance.records.size).toBe(0)
      expect(instance.ownerRecord()?.state).toBe('closed')
    } finally {
      if (instance.records.get(record.token)?.state === 'active')
        await Effect.runPromise(
          instance.repository.markReleased(record.token, record.hostInstanceId),
        )
      await vi.advanceTimersByTimeAsync(30_000)
      await stopping
      instance.broker.close()
    }
  })
})
