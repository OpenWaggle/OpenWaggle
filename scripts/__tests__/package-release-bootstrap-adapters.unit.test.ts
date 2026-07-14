import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS,
  createBootstrapInterruptionCoordinator,
  type BootstrapSignalProcess,
} from '../package-release-bootstrap-adapters'

function createSignalHarness() {
  const listeners = new Map<string, () => void>()
  const signalProcess: BootstrapSignalProcess = {
    off: (signal, listener) => {
      if (listeners.get(signal) === listener) listeners.delete(signal)
    },
    on: (signal, listener) => {
      listeners.set(signal, listener)
    },
    pid: 42,
    scheduleFallback: (listener) => {
      const timeout = setTimeout(listener, BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS)
      return () => clearTimeout(timeout)
    },
    sendSignal: vi.fn(),
  }
  return {
    listeners,
    signalProcess,
  }
}

afterEach(() => vi.useRealTimers())

describe('package release bootstrap transaction interruption', () => {
  it('waits for child settlement, MFA recovery, and cleanup before restoring a signal', async () => {
    vi.useFakeTimers()
    const childSettled = Promise.withResolvers<void>()
    const mfaRecovered = Promise.withResolvers<void>()
    const events: string[] = []
    const { listeners, signalProcess } = createSignalHarness()
    const interruptions = createBootstrapInterruptionCoordinator(signalProcess)
    const child = { kill: vi.fn(() => true) }

    const operation = interruptions.protect(async () => {
      events.push('publish-started')
      await childSettled.promise
      events.push('mfa-recovery-started')
      await mfaRecovered.promise
      events.push('temp-cleaned')
    })
    await vi.waitFor(() => expect(events).toEqual(['publish-started']))
    const untrackChild = interruptions.trackChild(child)

    listeners.get('SIGINT')?.()
    expect(child.kill).toHaveBeenCalledWith('SIGINT')
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS)
    expect(signalProcess.sendSignal).not.toHaveBeenCalled()
    untrackChild()
    childSettled.resolve()
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS - 1)
    expect(events).toContain('mfa-recovery-started')
    expect(signalProcess.sendSignal).not.toHaveBeenCalled()
    mfaRecovered.resolve()
    await operation

    expect(events).toEqual(['publish-started', 'mfa-recovery-started', 'temp-cleaned'])
    expect(signalProcess.sendSignal).toHaveBeenCalledWith(42, 'SIGINT')
    expect(listeners.size).toBe(0)
  })

  it('uses the bounded fallback when a protected transaction does not settle', async () => {
    vi.useFakeTimers()
    const childSettled = Promise.withResolvers<void>()
    const recoveryStalled = Promise.withResolvers<void>()
    const { listeners, signalProcess } = createSignalHarness()
    const interruptions = createBootstrapInterruptionCoordinator(signalProcess)
    const child = { kill: vi.fn(() => true) }
    void interruptions.protect(async () => {
      await childSettled.promise
      await recoveryStalled.promise
    })
    await vi.advanceTimersByTimeAsync(0)
    const untrackChild = interruptions.trackChild(child)

    listeners.get('SIGTERM')?.()
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS)
    expect(signalProcess.sendSignal).not.toHaveBeenCalled()
    untrackChild()
    childSettled.resolve()
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_SECURITY_RECOVERY_TIMEOUT_MS)

    expect(signalProcess.sendSignal).toHaveBeenCalledWith(42, 'SIGTERM')
    expect(listeners.size).toBe(0)
    recoveryStalled.resolve()
  })

  it('forwards a second signal immediately while the first signal is deferred', async () => {
    const pending = Promise.withResolvers<void>()
    const { listeners, signalProcess } = createSignalHarness()
    const interruptions = createBootstrapInterruptionCoordinator(signalProcess)
    void interruptions.protect(() => pending.promise)
    await vi.waitFor(() => expect(listeners.has('SIGINT')).toBe(true))

    listeners.get('SIGINT')?.()
    expect(signalProcess.sendSignal).not.toHaveBeenCalled()
    listeners.get('SIGTERM')?.()

    expect(signalProcess.sendSignal).toHaveBeenCalledWith(42, 'SIGTERM')
    expect(listeners.size).toBe(0)
    pending.resolve()
  })
})
