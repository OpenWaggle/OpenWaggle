import { SessionNodeId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useSessionCopyWorkflow } from '../useSessionCopyWorkflow'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    cloneSessionToNew: vi.fn(),
    forkSessionToNew: vi.fn(),
  },
}))

it('keeps session copy commands safe when there is no active session or fork target', async () => {
  const showToast = vi.fn()
  const { result } = renderHook(() =>
    useSessionCopyWorkflow({
      activeSessionId: null,
      activeWorkspace: null,
      draftBranchSourceNodeId: SessionNodeId('draft-source'),
      model: SupportedModelId('openai/gpt-5.5'),
      projectPath: '/repo',
      navigate: vi.fn(),
      setActiveSession: vi.fn(),
      loadSessions: vi.fn().mockResolvedValue(undefined),
      refreshSession: vi.fn().mockResolvedValue(undefined),
      refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
      showToast,
    }),
  )

  await act(() => result.current.cloneCurrentSessionToNewSession())
  act(() => result.current.openForkSelector())

  expect(showToast).toHaveBeenCalledWith('No active session to clone.')
  expect(showToast).toHaveBeenCalledWith('No user messages are available to fork.')
})
