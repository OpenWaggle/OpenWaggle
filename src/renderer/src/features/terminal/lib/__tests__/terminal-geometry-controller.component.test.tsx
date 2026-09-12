import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTerminalGeometryController } from '../terminal-geometry-controller'

const FRAME_INTERVAL_MS = 16
const MAX_STABLE_OPEN_LATENCY_MS = 50
const RESIZE_DEBOUNCE_MS = 150

interface AnimationFrameHarness {
  readonly cancel: ReturnType<typeof vi.fn>
  readonly elapsedMs: () => number
  readonly flush: () => void
  readonly pending: () => number
}

function installAnimationFrames(): AnimationFrameHarness {
  let nextHandle = 1
  let timestamp = 0
  const callbacks = new Map<number, FrameRequestCallback>()
  const cancel = vi.fn((handle: number) => {
    callbacks.delete(handle)
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(cancel)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const handle = nextHandle
    nextHandle += 1
    callbacks.set(handle, callback)
    return handle
  })

  return {
    cancel,
    elapsedMs: () => timestamp,
    flush() {
      const entry = callbacks.entries().next().value
      if (entry === undefined) throw new Error('Expected a pending animation frame.')
      const [handle, callback] = entry
      callbacks.delete(handle)
      timestamp += FRAME_INTERVAL_MS
      callback(timestamp)
    },
    pending: () => callbacks.size,
  }
}

function installResizeObserver() {
  let callback: ResizeObserverCallback | null = null
  const disconnect = vi.fn()
  const observe = vi.fn()
  const observer = {
    disconnect,
    observe,
    unobserve: vi.fn(),
  } satisfies ResizeObserver
  function TestResizeObserver(nextCallback: ResizeObserverCallback) {
    callback = nextCallback
    return observer
  }

  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  return {
    disconnect,
    observe,
    trigger() {
      if (callback === null) throw new Error('Expected an active ResizeObserver.')
      callback([], observer)
    },
  }
}

function makeHarness() {
  const container = document.createElement('div')
  let width = 800
  let height = 320
  let attached = false
  let disposed = false
  let openStarted = false
  const fit = vi.fn()
  const open = vi.fn(() => {
    openStarted = true
  })
  const resize = vi.fn()
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() =>
    DOMRect.fromRect({ width, height }),
  )
  const controller = createTerminalGeometryController({
    container,
    fit,
    isAttached: () => attached,
    isDisposed: () => disposed,
    isOpenStarted: () => openStarted,
    open,
    resize,
    resizeDebounceMs: RESIZE_DEBOUNCE_MS,
  })

  return {
    controller,
    fit,
    open,
    resize,
    setAttached: (next: boolean) => {
      attached = next
    },
    setDisposed: (next: boolean) => {
      disposed = next
    },
    setGeometry: (nextWidth: number, nextHeight: number) => {
      width = nextWidth
      height = nextHeight
    },
  }
}

describe('createTerminalGeometryController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('opens only after two consecutive equal animation-frame measurements', () => {
    const animationFrames = installAnimationFrames()
    const resizeObserver = installResizeObserver()
    const harness = makeHarness()

    harness.controller.synchronize()
    animationFrames.flush()

    expect(harness.fit).toHaveBeenCalledOnce()
    expect(harness.open).not.toHaveBeenCalled()
    expect(animationFrames.pending()).toBe(1)

    animationFrames.flush()

    expect(harness.fit).toHaveBeenCalledTimes(2)
    expect(harness.open).toHaveBeenCalledOnce()
    expect(animationFrames.elapsedMs()).toBeLessThanOrEqual(MAX_STABLE_OPEN_LATENCY_MS)
    expect(resizeObserver.observe).toHaveBeenCalledOnce()
    expect(animationFrames.pending()).toBe(0)
  })

  it('restarts the two-frame gate after geometry or observer churn', () => {
    const animationFrames = installAnimationFrames()
    const resizeObserver = installResizeObserver()
    const harness = makeHarness()

    harness.controller.synchronize()
    animationFrames.flush()
    harness.setGeometry(960, 400)
    resizeObserver.trigger()
    animationFrames.flush()

    expect(harness.open).not.toHaveBeenCalled()

    resizeObserver.trigger()
    animationFrames.flush()

    expect(harness.open).not.toHaveBeenCalled()

    animationFrames.flush()

    expect(harness.open).toHaveBeenCalledOnce()
    expect(harness.fit).toHaveBeenCalledTimes(4)
  })

  it('parks at zero geometry and opens after a positive stable observer transition', () => {
    const animationFrames = installAnimationFrames()
    const resizeObserver = installResizeObserver()
    const harness = makeHarness()

    harness.setGeometry(0, 0)
    harness.controller.synchronize()
    animationFrames.flush()

    expect(harness.fit).not.toHaveBeenCalled()
    expect(harness.open).not.toHaveBeenCalled()
    expect(animationFrames.pending()).toBe(0)

    const positiveTransitionStartedAt = animationFrames.elapsedMs()
    harness.setGeometry(800, 320)
    resizeObserver.trigger()
    animationFrames.flush()
    animationFrames.flush()

    expect(harness.fit).toHaveBeenCalledTimes(2)
    expect(harness.open).toHaveBeenCalledOnce()
    expect(animationFrames.elapsedMs() - positiveTransitionStartedAt).toBeLessThanOrEqual(
      MAX_STABLE_OPEN_LATENCY_MS,
    )
  })

  it('parks an unequal validation frame until the next geometry signal', () => {
    const animationFrames = installAnimationFrames()
    const resizeObserver = installResizeObserver()
    const harness = makeHarness()

    harness.controller.synchronize()
    animationFrames.flush()
    harness.setGeometry(960, 400)
    animationFrames.flush()

    expect(harness.open).not.toHaveBeenCalled()
    expect(animationFrames.pending()).toBe(0)

    resizeObserver.trigger()
    animationFrames.flush()
    animationFrames.flush()

    expect(harness.open).toHaveBeenCalledOnce()
  })

  it('keeps one trailing resize at the configured debounce after opening', () => {
    const animationFrames = installAnimationFrames()
    const resizeObserver = installResizeObserver()
    const harness = makeHarness()

    harness.controller.synchronize()
    animationFrames.flush()
    animationFrames.flush()
    harness.setAttached(true)

    resizeObserver.trigger()
    animationFrames.flush()
    vi.advanceTimersByTime(100)
    resizeObserver.trigger()
    animationFrames.flush()
    vi.advanceTimersByTime(RESIZE_DEBOUNCE_MS - 1)

    expect(harness.resize).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)

    expect(harness.resize).toHaveBeenCalledOnce()
  })

  it('cancels pending geometry and resize work on dispose', () => {
    const animationFrames = installAnimationFrames()
    const resizeObserver = installResizeObserver()
    const harness = makeHarness()

    harness.controller.synchronize()
    animationFrames.flush()
    animationFrames.flush()
    harness.setAttached(true)
    resizeObserver.trigger()
    animationFrames.flush()
    resizeObserver.trigger()
    harness.setDisposed(true)
    harness.controller.dispose()
    vi.runAllTimers()

    expect(animationFrames.cancel).toHaveBeenCalledOnce()
    expect(resizeObserver.disconnect).toHaveBeenCalledOnce()
    expect(harness.resize).not.toHaveBeenCalled()
  })
})
