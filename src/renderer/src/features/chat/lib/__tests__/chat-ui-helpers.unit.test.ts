// @vitest-environment jsdom

import { SessionId } from '@shared/types/brand'
import { describe, expect, it, vi } from 'vitest'
import { reportAutoSendQueueFailure, reportQueuedSteerFailure } from '../queue-failure-feedback'
import {
  getMaxScrollTop,
  isScrollContainerNearBottom,
  scrollElementToBottom,
} from '../scroll-to-bottom'

describe('scroll-to-bottom helpers', () => {
  it('treats invalid positions as near-bottom to avoid blocking autoscroll', () => {
    expect(
      isScrollContainerNearBottom({ scrollTop: Number.NaN, clientHeight: 100, scrollHeight: 200 }),
    ).toBe(true)
  })

  it('clamps negative thresholds and detects distance from bottom', () => {
    expect(
      isScrollContainerNearBottom({ scrollTop: 100, clientHeight: 100, scrollHeight: 200 }, -1),
    ).toBe(true)
    expect(
      isScrollContainerNearBottom({ scrollTop: 20, clientHeight: 100, scrollHeight: 200 }, 10),
    ).toBe(false)
  })

  it('computes max scroll top without returning negative values', () => {
    const element = document.createElement('div')
    Object.defineProperties(element, {
      clientHeight: { value: 200 },
      scrollHeight: { value: 120 },
    })

    expect(getMaxScrollTop(element)).toBe(0)
  })

  it('uses scrollTo when available and falls back to scrollTop otherwise', () => {
    const withScrollTo = document.createElement('div')
    const scrollToMock = vi.fn()
    Object.defineProperties(withScrollTo, {
      scrollHeight: { value: 300 },
      scrollTo: { value: scrollToMock },
    })

    scrollElementToBottom(withScrollTo, 'smooth')

    expect(scrollToMock).toHaveBeenCalledWith({ top: 300, behavior: 'smooth' })

    const withoutScrollTo = document.createElement('div')
    Object.defineProperty(withoutScrollTo, 'scrollHeight', { value: 400 })
    Object.defineProperty(withoutScrollTo, 'scrollTo', { value: undefined })

    scrollElementToBottom(withoutScrollTo, 'auto')

    expect(withoutScrollTo.scrollTop).toBe(400)
  })
})

describe('queue failure feedback', () => {
  it('logs and notifies when auto-send fails', () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const showToast = vi.fn()

    reportAutoSendQueueFailure(
      { logger, showToast },
      SessionId('session-1'),
      { text: 'queued prompt', thinkingLevel: 'medium', attachments: [] },
      new Error('offline'),
    )

    expect(logger.error).toHaveBeenCalledWith('Failed to auto-send queued message', {
      sessionId: SessionId('session-1'),
      error: 'offline',
      queuedText: 'queued prompt',
    })
    expect(showToast).toHaveBeenCalledWith(
      'Queued message failed to send automatically. It stayed in the queue.',
    )
  })

  it('logs and notifies when queued steering fails with non-error values', () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    const showToast = vi.fn()

    reportQueuedSteerFailure({ logger, showToast }, SessionId('session-1'), 'message-1', 'denied')

    expect(logger.error).toHaveBeenCalledWith('Failed to steer queued message', {
      sessionId: SessionId('session-1'),
      messageId: 'message-1',
      error: 'denied',
    })
    expect(showToast).toHaveBeenCalledWith(
      'Could not steer the queued message. It was returned to the queue.',
    )
  })
})
