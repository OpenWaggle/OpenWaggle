import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewAutomationDeadline } from '../browser-preview-automation-deadline'

describe('browser preview automation deadline', () => {
  it('rejects a pending operation when its caller cancels', async () => {
    const upstream = new AbortController()
    const deadline = new BrowserPreviewAutomationDeadline({
      signal: upstream.signal,
      timeoutMs: 5_000,
    })
    const pending = deadline.race(new Promise<never>(() => undefined))

    upstream.abort()

    await expect(pending).rejects.toThrow('cancelled')
    deadline.dispose()
  })

  it('bounds a command that never settles', async () => {
    vi.useFakeTimers()
    const deadline = new BrowserPreviewAutomationDeadline({ timeoutMs: 50 })
    const pending = deadline.race(new Promise<never>(() => undefined))
    const rejection = expect(pending).rejects.toThrow('timed out within 50 ms')

    await vi.advanceTimersByTimeAsync(50)

    await rejection
    deadline.dispose()
    vi.useRealTimers()
  })

  it('rejects invalid timeout bounds', () => {
    expect(() => new BrowserPreviewAutomationDeadline({ timeoutMs: 0 })).toThrow(
      'timeout must be between',
    )
    expect(() => new BrowserPreviewAutomationDeadline({ timeoutMs: 60_001 })).toThrow(
      'timeout must be between',
    )
  })
})
