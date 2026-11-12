import { act, render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionSummarySpace } from '../use-session-summary-space'

describe('useSessionSummarySpace', () => {
  const observed: Element[] = []
  const observedOptions: (ResizeObserverOptions | undefined)[] = []
  const callbacks: ResizeObserverCallback[] = []

  beforeEach(() => {
    observed.length = 0
    observedOptions.length = 0
    callbacks.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback)
        }
        observe(element: Element, options?: ResizeObserverOptions) {
          observed.push(element)
          observedOptions.push(options)
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
  it('observes the panel border box before the commit that mounts it can paint', () => {
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
    // Docking moves the conversation frames, not the panel's border box, so it cannot feed back.
    expect(observedOptions).toEqual([{ box: 'border-box' }])
  })

  function renderPanel() {
    function Panel() {
      const { panelRef, hasSpace } = useSessionSummarySpace(false)
      return <div ref={panelRef} data-testid="panel" data-has-space={String(hasSpace)} />
    }
    const panel = render(<Panel />).getByTestId('panel')
    const resize = (width: number) => {
      Object.defineProperty(panel, 'clientWidth', { configurable: true, value: width })
      const [callback] = callbacks
      if (!callback) throw new Error('The panel is not observed.')
      act(() => callback([], { observe() {}, unobserve() {}, disconnect() {} }))
      return {
        hasSpace: panel.dataset.hasSpace === 'true',
        reserve: panel.style.getPropertyValue('--session-summary-reserve'),
      }
    }
    return { resize }
  }

  // The chat's minimum width beside the Summary's 332px footprint (300 + 16 inset + 16 gap).
  it.each([
    [440, false, '332px'],
    [751, false, '332px'],
    [752, true, '332px'],
    [840, true, '332px'],
    [1_080, true, '304px'],
    [1_368, true, '16px'],
    [1_560, true, '0px'],
  ])('measures a %ipx chat panel: docks %s, reserve %s', (width, docks, reserve) => {
    // Start on the other side of the threshold so the result is the measurement's, not the default.
    const panel = renderPanel()
    panel.resize(docks ? 440 : 1_560)
    expect(panel.resize(width)).toEqual({ hasSpace: docks, reserve })
  })

  it('keeps its answer when the same width is reported again', () => {
    const panel = renderPanel()
    const first = panel.resize(900)
    expect(panel.resize(900)).toEqual(first)
    expect(first.hasSpace).toBe(true)
  })
})
