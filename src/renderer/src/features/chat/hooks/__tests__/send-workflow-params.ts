import { SessionId, SupportedModelId } from '@shared/types/brand'
import { vi } from 'vitest'
import type { useChatSendWorkflow } from '../useChatSendWorkflow'

export const SEND_WORKFLOW_SESSION_ID = SessionId('session-1')
export const SEND_WORKFLOW_MODEL = SupportedModelId('openai/gpt-5.5')

export type SendWorkflowParams = Parameters<typeof useChatSendWorkflow>[0]

/** Send-workflow dependencies with inert defaults; tests override the ones they observe. */
export function sendWorkflowParams(
  overrides: Partial<SendWorkflowParams> = {},
): SendWorkflowParams {
  return {
    activeSessionId: SEND_WORKFLOW_SESSION_ID,
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
    followBranchHead: vi.fn(),
    handleSend: vi.fn().mockResolvedValue(undefined),
    handleSendWaggle: vi.fn().mockResolvedValue(undefined),
    messages: [],
    model: SEND_WORKFLOW_MODEL,
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
