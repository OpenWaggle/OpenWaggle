import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  notifyResize,
  renderPanel,
  SESSION,
  setupChatPanelSessionSummaryHarness,
} from './chat-panel-session-summary.test-harness'

/**
 * Whether the Session Summary fits beside the chat was measured in a mount layout effect, which
 * forced the shell's first layout inside its commit (B12). The panel's ResizeObserver reports
 * its first observation after layout and before paint, and measures there instead.
 */
describe('ChatPanel first layout', () => {
  beforeEach(() => setupChatPanelSessionSummaryHarness())
  afterEach(() => vi.restoreAllMocks())

  it('reads no layout while it first commits, only once the size is observed', () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)

    renderPanel({}, { isFirstMessage: false, session: SESSION })
    expect(width).not.toHaveBeenCalled()

    act(() => notifyResize())
    expect(width).toHaveBeenCalled()
  })
})
