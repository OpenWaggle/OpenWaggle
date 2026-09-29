import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatSendWorkflow } from '../useChatSendWorkflow'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openai/gpt-5.5')

type SendWorkflowParams = Parameters<typeof useChatSendWorkflow>[0]

function payload(text: string): AgentSendPayload {
  return { text, thinkingLevel: 'medium', attachments: [] }
}

function sendWorkflowParams(overrides: Partial<SendWorkflowParams> = {}): SendWorkflowParams {
  return {
    activeSessionId: SESSION_ID,
    branchSummary: {
      materializeBranchSummary: vi.fn().mockResolvedValue(undefined),
      materializeDraftBranchForSend: vi.fn().mockResolvedValue(true),
      cancelBranchSummary: vi.fn(),
      skipBranchSummary: vi.fn(),
      startCustomBranchSummary: vi.fn(),
      switchComposerToDraftBranch: vi.fn(),
    },
    clearDraftBranchForSession: vi.fn(),
    draftBranch: null,
    extensionContributions: null,
    handleSend: vi.fn().mockResolvedValue(undefined),
    handleSendWaggle: vi.fn().mockResolvedValue(undefined),
    messages: [],
    model: MODEL,
    phase: { reset: vi.fn() },
    projectPath: '/tmp/project',
    refreshSession: vi.fn().mockResolvedValue(undefined),
    refreshSessionWorkspace: vi.fn().mockResolvedValue(undefined),
    sessionCopy: {
      forkSelectorOpen: false,
      forkTargets: [],
      closeForkSelector: vi.fn(),
      cloneCurrentSessionToNewSession: vi.fn().mockResolvedValue(undefined),
      forkMessageToNewSession: vi.fn().mockResolvedValue(undefined),
      openForkSelector: vi.fn(),
      selectForkTarget: vi.fn(),
    },
    beginPendingSend: vi.fn(),
    clearPendingSend: vi.fn(),
    showToast: vi.fn(),
    startWaggleCollaboration: vi.fn(),
    stop: vi.fn(),
    stopWaggleCollaboration: vi.fn(),
    waggleStatus: 'idle',
    ...overrides,
  } satisfies SendWorkflowParams
}

/** The baseline a send records so the transcript can hold its own optimistic row (ADR 0036). */
describe('useChatSendWorkflow pending send', () => {
  beforeEach(() => {
    useBranchSummaryStore.getState().clearPrompt()
  })

  it('records the latest user message as the send baseline before sending', async () => {
    const beginPendingSend = vi.fn()
    const handleSend = vi.fn(() => {
      expect(beginPendingSend).toHaveBeenLastCalledWith({ afterUserMessageId: 'latest-user' })
      return Promise.resolve()
    })
    const messages = [
      { id: 'older-user', role: 'user' as const, parts: [] },
      { id: 'latest-user', role: 'user' as const, parts: [] },
      { id: 'answer', role: 'assistant' as const, parts: [] },
    ]
    const params = sendWorkflowParams({ handleSend, messages, beginPendingSend })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle(payload('Next question')))
    expect(handleSend).toHaveBeenCalledOnce()
  })

  it('clears the pending send when the send is refused', async () => {
    const params = sendWorkflowParams({
      handleSend: vi.fn().mockRejectedValue(new MessageNotDelivered('refused', 'No model.')),
    })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await expect(act(() => result.current.sendWithWaggle(payload('Hello')))).rejects.toBeInstanceOf(
      MessageNotDelivered,
    )
    // The exact send it began is cleared, so a newer send in its place survives.
    const begun = vi.mocked(params.beginPendingSend).mock.calls[0]?.[0]
    expect(params.clearPendingSend).toHaveBeenCalledWith(begun)
  })
})
