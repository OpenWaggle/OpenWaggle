import { SessionId } from '@shared/types/brand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPinnedInlineVisualizationFramesForTests,
  pinInlineVisualizationFrame,
} from '../../components/inline-visualization-frame-retention'
import {
  clearInlineVisualizationStatesForTests,
  retainedInlineVisualizationState,
  retainInlineVisualizationState,
} from '../inline-visualization-state'

describe('inline visualization retention', () => {
  afterEach(() => {
    clearInlineVisualizationStatesForTests()
    clearPinnedInlineVisualizationFramesForTests()
  })

  it('keeps the last reported state per Session source until it is cleared', () => {
    const session = SessionId('session-a')
    retainInlineVisualizationState(session, '/v/picker.html', { selected: 'A' })
    retainInlineVisualizationState(session, '/v/picker.html', { selected: 'B' })

    expect(retainedInlineVisualizationState(session, '/v/picker.html')).toEqual({ selected: 'B' })
    expect(retainedInlineVisualizationState(SessionId('session-b'), '/v/picker.html')).toBeNull()

    retainInlineVisualizationState(session, '/v/picker.html', null)
    expect(retainedInlineVisualizationState(session, '/v/picker.html')).toBeNull()
  })

  it('bounds retained states by recency', () => {
    const session = SessionId('session-a')
    for (let index = 0; index < 130; index += 1) {
      retainInlineVisualizationState(session, `/v/${String(index)}.html`, index)
    }

    expect(retainedInlineVisualizationState(session, '/v/0.html')).toBeNull()
    expect(retainedInlineVisualizationState(session, '/v/129.html')).toBe(129)
  })

  it('releases the least recently engaged frame beyond the pinned budget', () => {
    const releases = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    for (const [index, release] of releases.entries()) {
      pinInlineVisualizationFrame(`frame-${String(index)}`, release)
    }
    pinInlineVisualizationFrame('frame-1', releases[1] ?? vi.fn())
    pinInlineVisualizationFrame('frame-4', vi.fn())

    expect(releases[0]).toHaveBeenCalledOnce()
    expect(releases[2]).toHaveBeenCalledOnce()
    expect(releases[1]).not.toHaveBeenCalled()
    expect(releases[3]).not.toHaveBeenCalled()
  })
})
