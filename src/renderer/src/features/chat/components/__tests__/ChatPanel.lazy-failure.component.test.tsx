import { act, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Summary and resource viewer chunk cannot load, as when an update swapped the hashed renderer
// chunks under a running app.
vi.mock('@/features/session-summary/components/SessionResourceViewer', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

import { makeMessage } from './ChatPanel.test-utils'
import {
  renderPanel,
  SESSION,
  setupChatPanelSessionSummaryHarness,
} from './chat-panel-session-summary.test-harness'

/*
 * PR 391 review R2 P3-5: the Session Summary and the resource viewer load lazily beside the chat.
 * A chunk that fails to load unmounted everything up to the nearest boundary, the whole Chat panel
 * with its transcript and composer; each lazy surface now has its own.
 */
describe('ChatPanel when a lazy surface fails to load', () => {
  beforeEach(() => {
    setupChatPanelSessionSummaryHarness()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('keeps the transcript and the composer mounted', async () => {
    const message = makeMessage({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'Hello agent' }],
    })
    renderPanel(
      {
        messages: [message],
        chatRows: [
          {
            type: 'message',
            message,
            isStreaming: false,
            isRunActive: false,
            showTurnDivider: false,
          },
        ],
      },
      { isFirstMessage: false, session: SESSION },
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(await screen.findByText('Session Summary panel error')).toBeInTheDocument()
    expect(screen.getByText('Hello agent')).toBeInTheDocument()
    expect(document.querySelector('[data-chat-composer-form="true"]')).not.toBeNull()
  })
})
