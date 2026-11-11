import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installIdleCallbackPolyfill } from '../idle-callback-polyfill'

afterEach(() => {
  vi.useRealTimers()
})

function webviewWithoutIdleCallbacks() {
  vi.useFakeTimers()
  return fromPartial<Window>({
    setTimeout: (handler: () => void) => setTimeout(handler),
    clearTimeout: (handle?: number) => clearTimeout(handle),
  })
}

describe('installIdleCallbackPolyfill', () => {
  it('runs idle work on the next task with a frame budget, and cancels it', () => {
    const target = webviewWithoutIdleCallbacks()
    expect(installIdleCallbackPolyfill(target)).toBe(true)
    const budgets: number[] = []
    target.requestIdleCallback((deadline) => budgets.push(deadline.timeRemaining()))
    target.cancelIdleCallback(target.requestIdleCallback(() => budgets.push(-1)))
    vi.runAllTimers()
    expect(budgets).toHaveLength(1)
    expect(budgets[0]).toBeGreaterThan(0)
  })

  it('keeps a native implementation', () => {
    const native = vi.fn()
    const target = fromPartial<Window>({ requestIdleCallback: native })
    expect(installIdleCallbackPolyfill(target)).toBe(false)
    expect(target.requestIdleCallback).toBe(native)
  })
})
