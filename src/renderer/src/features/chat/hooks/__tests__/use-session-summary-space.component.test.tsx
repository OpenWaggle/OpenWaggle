import { act, render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionSummarySpace } from '../use-session-summary-space'

/** The 316px sidebar and the 44px panel rail beside the chat panel. */
const WINDOW_CHROME_PX = 316 + 44

describe('useSessionSummarySpace', () => {
  const observed: Element[] = []
  const callbacks: ResizeObserverCallback[] = []

  beforeEach(() => {
    observed.length = 0
    callbacks.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback)
        }
        observe(element: Element) {
          observed.push(element)
        }
        disconnect() {}
        unobserve() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  /*
   * PR 391 review R2 P3-3: the first Summary-space measurement comes from a ResizeObserver, which
   * reports in the rendering steps of the next frame after it starts observing. Attached in a
   * passive effect, which React may run after paint, a narrow window first painted the docked
   * Summary. It has to observe the panel by the end of the commit's layout effects.
   */
  it('observes the panel before the commit that mounts it can paint', () => {
    const observedDuringLayout: number[] = []
    function Panel() {
      const { panelRef } = useSessionSummarySpace(false)
      return <div ref={panelRef} />
    }
    /** Runs after the panel's layout effects, before any passive effect. */
    function LayoutProbe() {
      useLayoutEffect(() => {
        observedDuringLayout.push(observed.length)
      }, [])
      return null
    }

    render(
      <>
        <Panel />
        <LayoutProbe />
      </>,
    )

    expect(observedDuringLayout).toEqual([1])
  })

  /** The chat panel of a `windowWidth` window, as measured in the app, reported to the hook. */
  function measureWindow(windowWidth: number) {
    let hasSpace = true
    function Panel() {
      const space = useSessionSummarySpace(false)
      hasSpace = space.hasSpace
      return <div ref={space.panelRef} data-testid="panel" />
    }
    const view = render(<Panel />)
    Object.defineProperty(view.getByTestId('panel'), 'clientWidth', {
      configurable: true,
      value: windowWidth - WINDOW_CHROME_PX,
    })
    const [callback] = callbacks
    if (!callback) throw new Error('The panel is not observed.')
    act(() => callback([], { observe() {}, unobserve() {}, disconnect() {} }))
    return hasSpace
  }

  /*
   * The Summary used to dock only where it fit beside the centered conversation column, a chat
   * panel of about 1,384px, so it was hidden by default in the default 1,200px window and in
   * laptop-width ones, including a 1,728px MacBook Pro window, 8px short.
   */
  it.each([1200, 1440, 1512, 1728])('docks the Summary by default in a %ipx window', (width) => {
    expect(measureWindow(width)).toBe(true)
  })

  it('leaves the Summary to be opened by hand where it would leave too little conversation', () => {
    // The minimum 800px window leaves a 440px chat panel beside the sidebar.
    expect(measureWindow(800)).toBe(false)
  })
})
