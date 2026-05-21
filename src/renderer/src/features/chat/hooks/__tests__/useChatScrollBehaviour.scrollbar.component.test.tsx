// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  createDefaultParams,
  createTestLayout,
  installChatScrollTestEnvironment,
  renderScrollHook,
} from './useChatScrollBehaviour.test-utils'

describe('useChatScrollBehaviour scrollbar visibility behavior', () => {
  installChatScrollTestEnvironment()

  it('showScrollbar starts false and becomes true on scroll then hides', () => {
    const layout = createTestLayout()
    const { result } = renderScrollHook(createDefaultParams(), layout)

    expect(result.current.showScrollbar).toBe(false)

    act(() => {
      result.current.handleScroll()
    })
    expect(result.current.showScrollbar).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.showScrollbar).toBe(false)
  })
})
