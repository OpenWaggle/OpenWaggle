import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DesktopNativeQuarantinedError,
  DesktopServiceAttachmentError,
  startGuiDesktopServiceBridge,
} from '../gui-desktop-service-bridge'
import { DESKTOP_SHUTDOWN_DRAIN_MS } from '../gui-desktop-service-lifecycle'
import {
  bridgeHarness,
  DESKTOP_TEST_GUI_ID,
  stopBridge,
} from './gui-desktop-service-bridge.test-harness'

vi.mock('../local-session-client', () => ({ executeLocalSessionCommand: vi.fn() }))
vi.mock('../local-session-paths', () => ({ refreshLocalSessionHostEndpoint: vi.fn() }))
vi.mock('../../logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('GUI desktop bridge lifecycle', () => {
  it('requires stopped transport before accepting an exact clean native receipt', async () => {
    const instance = bridgeHarness()
    const lifecycle = await startGuiDesktopServiceBridge(instance.input)
    await expect(lifecycle.markClosed()).rejects.toThrow('must drain')
    await stopBridge(lifecycle)
    await lifecycle.markClosed()
    expect(instance.calls.at(-1)).toEqual({
      operation: 'markClosed',
      guiInstanceId: DESKTOP_TEST_GUI_ID,
      hostInstanceId: 'host-one',
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains cleanup authority when initial registration succeeds but readiness fails', async () => {
    const instance = bridgeHarness()
    instance.state.readyFailures = 1
    const error: unknown = await startGuiDesktopServiceBridge(instance.input).catch(
      (error: unknown) => error,
    )
    expect(error).toBeInstanceOf(DesktopServiceAttachmentError)
    if (!(error instanceof DesktopServiceAttachmentError))
      throw new Error('Missing attachment cleanup handle')
    await stopBridge(error.lifecycle)
    await error.lifecycle.markClosed()
    expect(instance.calls.at(-1)).toEqual({
      operation: 'markClosed',
      guiInstanceId: DESKTOP_TEST_GUI_ID,
      hostInstanceId: 'host-one',
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not adopt or clean another uncertain native owner during quarantine', async () => {
    const instance = bridgeHarness()
    instance.state.quarantined = true
    await expect(startGuiDesktopServiceBridge(instance.input)).rejects.toBeInstanceOf(
      DesktopNativeQuarantinedError,
    )
    expect(instance.calls).toEqual([{ operation: 'register', guiInstanceId: DESKTOP_TEST_GUI_ID }])
    expect(instance.reconcile).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for a fresh post-drain poll rather than treating an older snapshot as cleanup proof', async () => {
    const instance = bridgeHarness()
    const lifecycle = await startGuiDesktopServiceBridge(instance.input)
    const stopping = lifecycle.stop()
    await vi.advanceTimersByTimeAsync(1100)
    expect(instance.calls.filter((request) => request.operation === 'poll')).toHaveLength(2)
    expect(instance.calls.some((request) => request.operation === 'disconnect')).toBe(false)
    await vi.advanceTimersByTimeAsync(3000)
    await stopping
    expect(instance.calls.some((request) => request.operation === 'disconnect')).toBe(true)
  })

  it('bounds a failed drain without releasing ownership, then supports a later clean retry', async () => {
    const instance = bridgeHarness()
    instance.state.activeFence = true
    const lifecycle = await startGuiDesktopServiceBridge(instance.input)
    const result = lifecycle.stop().then(
      () => null,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(DESKTOP_SHUTDOWN_DRAIN_MS + 1)
    expect(await result).toBeInstanceOf(Error)
    expect(instance.calls.some((request) => request.operation === 'resumeDesktop')).toBe(true)
    expect(instance.calls.some((request) => request.operation === 'disconnect')).toBe(false)
    expect(instance.calls.some((request) => request.operation === 'markClosed')).toBe(false)
    await expect(lifecycle.markClosed()).rejects.toThrow('must drain')
    instance.state.activeFence = false
    await stopBridge(lifecycle)
    await lifecycle.markClosed()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses the latest authenticated Host identity after a transport restart', async () => {
    const instance = bridgeHarness()
    const lifecycle = await startGuiDesktopServiceBridge(instance.input)
    instance.state.hostInstanceId = 'host-two'
    instance.state.pollFailures = 1
    await vi.advanceTimersByTimeAsync(2500)
    expect(instance.calls.filter((request) => request.operation === 'register')).toHaveLength(2)
    await stopBridge(lifecycle)
    await lifecycle.markClosed()
    expect(instance.calls.at(-1)).toEqual({
      operation: 'markClosed',
      guiInstanceId: DESKTOP_TEST_GUI_ID,
      hostInstanceId: 'host-two',
    })
  })

  it('keeps a rejected clean receipt explicit and retryable', async () => {
    const instance = bridgeHarness()
    const lifecycle = await startGuiDesktopServiceBridge(instance.input)
    await stopBridge(lifecycle)
    instance.state.rejectReceipt = true
    await expect(lifecycle.markClosed()).rejects.toThrow('was not acknowledged')
    instance.state.rejectReceipt = false
    await expect(lifecycle.markClosed()).resolves.toBeUndefined()
  })

  it('does not stop transport when shutdown admission was explicitly rejected', async () => {
    const instance = bridgeHarness()
    instance.state.rejectPreparation = true
    const lifecycle = await startGuiDesktopServiceBridge(instance.input)
    const result = lifecycle.stop().then(
      () => null,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(4000)
    try {
      expect(await result).toBeInstanceOf(Error)
      expect(instance.calls.some((request) => request.operation === 'disconnect')).toBe(false)
    } finally {
      instance.state.rejectPreparation = false
      await stopBridge(lifecycle)
    }
  })

  it('reports rejected admission recovery separately from the original drain failure', async () => {
    const instance = bridgeHarness()
    instance.state.activeFence = true
    instance.state.rejectResume = true
    const lifecycle = await startGuiDesktopServiceBridge(instance.input)
    const result = lifecycle.stop().then(
      () => null,
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(DESKTOP_SHUTDOWN_DRAIN_MS + 1)
    try {
      expect(await result).toBeInstanceOf(AggregateError)
      expect(instance.calls.some((request) => request.operation === 'disconnect')).toBe(false)
    } finally {
      instance.state.activeFence = false
      instance.state.rejectResume = false
      await stopBridge(lifecycle)
    }
  })
})
