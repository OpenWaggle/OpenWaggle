import { SessionId } from '@shared/types/brand'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavigateBackToApp } from '../useNavigateBackToApp'

const { navigateMock, chatMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  chatMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('../useChat', () => ({
  useChat: () => chatMock(),
}))

describe('useNavigateBackToApp', () => {
  beforeEach(() => {
    navigateMock.mockReset()
  })

  it('returns to the active session', () => {
    chatMock.mockReturnValue({ activeSessionId: SessionId('session-1') })
    const { result } = renderHook(() => useNavigateBackToApp())

    result.current()

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
    })
  })

  it('returns to the start view when no session is active', () => {
    chatMock.mockReturnValue({ activeSessionId: null })
    const { result } = renderHook(() => useNavigateBackToApp())

    result.current()

    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })
})
