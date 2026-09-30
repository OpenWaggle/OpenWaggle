import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SessionNodeId } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatSendWorkflow } from '../useChatSendWorkflow'
import { sendWorkflowParams } from './send-workflow-params'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))

const SESSION_ID = SessionId('session-1')

function payload(text: string): AgentSendPayload {
  return { text, thinkingLevel: 'medium', attachments: [] }
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

  it('follows the branch head once a send from a retry draft is delivered', async () => {
    const params = sendWorkflowParams({
      draftBranch: { sessionId: SESSION_ID, sourceNodeId: SessionNodeId('retry-source') },
    })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle(payload('Retried question')))

    expect(params.branchSummary.materializeDraftBranchForSend).toHaveBeenCalledWith(
      params.draftBranch,
    )
    expect(params.clearDraftBranchForSession).toHaveBeenCalledWith(SESSION_ID)
    expect(params.followBranchHead).toHaveBeenCalledWith(SESSION_ID)
  })

  it('keeps the routed node when the send is refused', async () => {
    const params = sendWorkflowParams({
      handleSend: vi.fn().mockRejectedValue(new MessageNotDelivered('refused', 'No model.')),
    })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await expect(act(() => result.current.sendWithWaggle(payload('Hello')))).rejects.toBeInstanceOf(
      MessageNotDelivered,
    )
    expect(params.followBranchHead).not.toHaveBeenCalled()
  })
})
