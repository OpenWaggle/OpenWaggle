import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMessage } from './ChatPanel.test-utils'
import {
  findSessionSummary,
  notifyResize,
  preloadSessionSummaryOverlay,
  renderPanelSettled,
  SESSION,
  setupChatPanelSessionSummaryHarness,
  toggleSessionSummaryPanel,
} from './chat-panel-session-summary.test-harness'

const floatingPreview = vi.hoisted(() => ({ visible: false }))

vi.mock('@/shell', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shell')>()),
  useSessionFloatingPreviewStatus: () => floatingPreview.visible,
}))

/** The chat panel of the default 1,200px window, beside the sidebar and the panel rail. */
const DEFAULT_WINDOW_CHAT_WIDTH_PX = 840

async function renderSentSession() {
  const message = makeMessage({
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', content: 'Hello agent' }],
  })
  await renderPanelSettled(
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
  const chatPanel = document.querySelector('[data-chat-panel-main="true"]')
  if (!(chatPanel instanceof HTMLElement)) throw new Error('Chat panel main element is missing.')
  return chatPanel
}

function resizeChatPanel(chatPanel: HTMLElement, width: number) {
  Object.defineProperty(chatPanel, 'clientWidth', { configurable: true, value: width })
  act(() => notifyResize())
}

function summary() {
  return screen.queryByRole('complementary', { name: 'Session Summary' })
}

describe('ChatPanel Session Summary docking', () => {
  preloadSessionSummaryOverlay()

  beforeEach(() => {
    floatingPreview.visible = false
    setupChatPanelSessionSummaryHarness()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /*
   * The Summary used to dock only where it fit beside the centered conversation column, a
   * 1,384px chat panel, so it was hidden by default in the default window and at laptop widths.
   */
  it('docks the Summary by default at the default window width', async () => {
    const chatPanel = await renderSentSession()
    resizeChatPanel(chatPanel, 700)
    expect(chatPanel).toHaveAttribute('data-session-summary-space', 'constrained')
    expect(summary()).toBeNull()

    resizeChatPanel(chatPanel, DEFAULT_WINDOW_CHAT_WIDTH_PX)

    expect(chatPanel).toHaveAttribute('data-session-summary-space', 'available')
    const docked = await findSessionSummary()
    expect(docked).toHaveAttribute('data-session-summary-mode', 'persistent')
    // The structure globals.css `.session-summary-docking:has(> div > aside[…])` matches.
    expect(chatPanel).toHaveClass('session-summary-docking')
    expect(docked.parentElement?.parentElement).toBe(chatPanel)
    expect(chatPanel.style.getPropertyValue('--session-summary-reserve')).toBe('332px')
  })

  it('docks the Summary again after a narrow resize, and hides it on request', async () => {
    const chatPanel = await renderSentSession()
    resizeChatPanel(chatPanel, DEFAULT_WINDOW_CHAT_WIDTH_PX)
    expect(await findSessionSummary()).toHaveAttribute('data-session-summary-mode', 'persistent')

    resizeChatPanel(chatPanel, 700)
    expect(summary()).toBeNull()

    resizeChatPanel(chatPanel, 1_080)
    expect(await findSessionSummary()).toHaveAttribute('data-session-summary-mode', 'persistent')
    expect(chatPanel.style.getPropertyValue('--session-summary-reserve')).toBe('304px')

    act(() => toggleSessionSummaryPanel('session-1'))
    expect(summary()).toBeNull()
  })

  it('opens a narrow chat Summary on request as a transient overlay, which reserves nothing', async () => {
    const chatPanel = await renderSentSession()
    resizeChatPanel(chatPanel, 700)

    act(() => toggleSessionSummaryPanel('session-1'))

    // The docking rule matches only a persistent Summary.
    expect(await findSessionSummary()).toHaveAttribute('data-session-summary-mode', 'transient')
  })

  it('opens the Summary as a transient overlay beside a floating browser preview', async () => {
    floatingPreview.visible = true
    const chatPanel = await renderSentSession()
    resizeChatPanel(chatPanel, 1_440)
    expect(summary()).toBeNull()

    act(() => toggleSessionSummaryPanel('session-1'))

    expect(await findSessionSummary()).toHaveAttribute('data-session-summary-mode', 'transient')
  })

  it('hides before paint when the chat mounts below the docking width', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(700)
    await renderSentSession()
    // A ResizeObserver reports its first observation after layout and before paint; its update
    // renders synchronously, so the summary is hidden in the first painted frame.
    act(() => notifyResize())

    expect(summary()).toBeNull()
  })
})
