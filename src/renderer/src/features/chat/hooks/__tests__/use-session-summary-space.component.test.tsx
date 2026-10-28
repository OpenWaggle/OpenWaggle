import { render } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionSummarySpace } from '../use-session-summary-space'

/*
 * PR 391 review R2 P3-3: the first Summary-space measurement comes from a ResizeObserver, which
 * reports in the rendering steps of the next frame after it starts observing. Attached in a passive
 * effect, which React may run after paint, a narrow window first painted the docked Summary. It has
 * to observe the panel by the end of the commit's layout effects.
 */
describe('useSessionSummarySpace', () => {
  const observed: Element[] = []

  beforeEach(() => {
    observed.length = 0
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(element: Element) {
          observed.push(element)
        }
        disconnect() {}
        unobserve() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it('observes the panel before the commit that mounts it can paint', () => {
    const observedDuringLayout: number[] = []
    function Panel() {
      const { panelRef } = useSessionSummarySpace(false)
      return (
        <div ref={panelRef}>
          <form data-chat-composer-form="true" />
        </div>
      )
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

    // The panel and the composer frame inside it.
    expect(observedDuringLayout).toEqual([2])
  })
})
