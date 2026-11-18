import type { JsonValue } from '@shared/types/json'
import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInlineVisualizationFrame } from '../use-inline-visualization-frame'

const FRAME_URL = 'openwaggle-visualization://frame/registration-1'

function Frame(props: {
  readonly onDismiss: () => void
  readonly onUnavailable: (reason: string) => void
  readonly onStateChange: (state: JsonValue | null) => void
}) {
  const { frameRef } = useInlineVisualizationFrame({
    interactionSessionId: null,
    frameUrl: FRAME_URL,
    registrationId: 'registration-1',
    ...props,
  })
  return <iframe ref={frameRef} title="Visualization" />
}

/*
 * PR 391 review R2 P3-10: the layout effect that loads the frame depended on controls whose
 * identity came from memoization on the callbacks, so new callbacks (or the compiler bailing out
 * of the hook) reloaded the visualization. Only the frame's URL, registration or Session load it.
 */
describe('useInlineVisualizationFrame', () => {
  const loads: string[] = []

  beforeEach(() => {
    loads.length = 0
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')
    vi.spyOn(HTMLIFrameElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLIFrameElement,
      value: string,
    ) {
      loads.push(value)
      descriptor?.set?.call(this, value)
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('loads the frame once while its callbacks change on every render', () => {
    const callbacks = () => ({
      onDismiss: vi.fn(),
      onUnavailable: vi.fn(),
      onStateChange: vi.fn(),
    })
    const view = render(<Frame {...callbacks()} />)
    view.rerender(<Frame {...callbacks()} />)
    view.rerender(<Frame {...callbacks()} />)

    expect(loads).toEqual([FRAME_URL])
    view.unmount()
  })

  it('reports the latest callback when the frame becomes unavailable', () => {
    vi.useFakeTimers()
    const first = vi.fn()
    const latest = vi.fn()
    const view = render(<Frame onDismiss={vi.fn()} onUnavailable={first} onStateChange={vi.fn()} />)
    view.rerender(<Frame onDismiss={vi.fn()} onUnavailable={latest} onStateChange={vi.fn()} />)

    // The frame never answers its health check.
    vi.advanceTimersByTime(2_000)

    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledWith('unresponsive')
    view.unmount()
    vi.useRealTimers()
  })
})
