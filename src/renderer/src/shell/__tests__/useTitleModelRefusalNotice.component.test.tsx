import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { TitleModelRefusalCopy, useTitleModelRefusalNotice } from '../useTitleModelRefusalNotice'

const { onSessionHostEvent, navigate } = vi.hoisted(() => ({
  onSessionHostEvent: vi.fn<(callback: (event: SessionHostEventEnvelope) => void) => () => void>(),
  navigate: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { onSessionHostEvent } }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const REASON = 'AccessDeniedException: Model access is denied due to IAM user or service role'

function refusal(sequence: number): SessionHostEventEnvelope {
  return {
    cursor: { hostInstanceId: 'host', sequence },
    timestamp: 1,
    payload: {
      kind: 'session-title-model-refused',
      model: 'amazon-bedrock/eu.anthropic.claude-haiku',
      reason: REASON,
      retryAt: 2,
    },
  }
}

beforeEach(() => {
  onSessionHostEvent.mockReset().mockReturnValue(vi.fn())
  navigate.mockReset()
  useUIStore.getState().clearToast()
})

it('says once which Title model was refused and why, and opens its setting', () => {
  renderHook(() => useTitleModelRefusalNotice())
  const receive = onSessionHostEvent.mock.calls[0]?.[0]
  if (!receive) throw new Error('Host subscription missing')

  act(() => {
    receive(refusal(1))
  })

  const toast = useUIStore.getState().toastData
  expect(toast?.message).toBe(
    TitleModelRefusalCopy.message('amazon-bedrock/eu.anthropic.claude-haiku', REASON),
  )
  expect(toast?.message).toContain('Sessions are titled with their own model')
  expect(toast?.variant).toBe('error')
  act(() => toast?.action?.onClick?.())
  expect(navigate).toHaveBeenCalledWith({ to: '/settings/$tab', params: { tab: 'connections' } })

  act(() => {
    useUIStore.getState().clearToast()
    receive(refusal(1))
  })
  expect(useUIStore.getState().toastData).toBeNull()
})
