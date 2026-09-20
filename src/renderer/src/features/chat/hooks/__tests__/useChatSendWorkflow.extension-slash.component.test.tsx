import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { AgentSendPayload } from '@shared/types/agent'
import { SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageNotDelivered } from '../../lib/message-delivery'
import { useBranchSummaryStore } from '../../state/branch-summary-store'
import { useChatSendWorkflow } from '../useChatSendWorkflow'

const { invokeExtensionMock, discardPreparedAttachment } = vi.hoisted(() => ({
  invokeExtensionMock: vi.fn(),
  discardPreparedAttachment: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    invokeExtension: invokeExtensionMock,
    discardPreparedAttachment,
  },
}))

const PROJECT_PATH = '/tmp/project'
const SESSION_ID = SessionId('session-1')
const MODEL = SupportedModelId('openai/gpt-5.5')

type SendWorkflowParams = Parameters<typeof useChatSendWorkflow>[0]

function payload(text: string): AgentSendPayload {
  return { text, thinkingLevel: 'medium', attachments: [] }
}

function extensionSlashEntry(
  overrides: Partial<ExtensionContributionRegistryEntry> = {},
): ExtensionContributionRegistryEntry {
  return {
    extensionId: 'sample-extension',
    extensionName: 'Sample Extension',
    extensionVersion: '1.0.0',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, label: 'Global' },
    packagePath: '/tmp/extensions/sample-extension',
    manifestPath: '/tmp/extensions/sample-extension/openwaggle.extension.json',
    projectPaths: [PROJECT_PATH],
    appliesToAllRequestedProjects: true,
    family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS,
    contributionId: 'sample.run',
    title: 'Run sample slash',
    label: 'Run sample slash',
    category: 'Sample',
    capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
    method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
    eligibility: {
      runtimeEnabled: true,
      enabled: true,
      trusted: true,
      sdkCompatible: true,
      updateAvailable: false,
      disabledProjectPaths: [],
    },
    diagnostics: [],
    contentHash: 'content-hash-1',
    invocationBinding: 'host-issued-binding',
    ...overrides,
  }
}

function extensionRegistry(
  entries: readonly ExtensionContributionRegistryEntry[],
): ExtensionContributionRegistryView {
  return {
    projectPaths: [PROJECT_PATH],
    entries,
  }
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
    extensionContributions: extensionRegistry([extensionSlashEntry()]),
    handleSend: vi.fn().mockResolvedValue(undefined),
    handleSendWaggle: vi.fn().mockResolvedValue(undefined),
    messages: [],
    model: MODEL,
    phase: { reset: vi.fn() },
    projectPath: PROJECT_PATH,
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
    setUserDidSend: vi.fn(),
    showToast: vi.fn(),
    startWaggleCollaboration: vi.fn(),
    stop: vi.fn(),
    stopWaggleCollaboration: vi.fn(),
    waggleStatus: 'idle',
    ...overrides,
  } satisfies SendWorkflowParams
}

describe('useChatSendWorkflow extension slash commands', () => {
  beforeEach(() => {
    invokeExtensionMock.mockReset()
    discardPreparedAttachment.mockClear()
    useBranchSummaryStore.getState().clearPrompt()
  })

  it('invokes extension slash commands through the generic broker API', async () => {
    invokeExtensionMock.mockResolvedValue({
      ok: true,
      value: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: SESSION_ID },
        declaredScopes: ['session'],
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: SESSION_ID },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.SUCCEEDED,
        timestamp: 1,
      },
    })
    const params = sendWorkflowParams()
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle(payload('/sample.run use current diff')))

    expect(invokeExtensionMock).toHaveBeenCalledWith(
      {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: SESSION_ID },
        payload: {
          command: '/sample.run',
          args: 'use current diff',
          rawText: '/sample.run use current diff',
        },
      },
      'host-issued-binding',
    )
    expect(params.handleSend).not.toHaveBeenCalled()
    expect(params.branchSummary.materializeDraftBranchForSend).not.toHaveBeenCalled()
  })

  it('keeps broker-rejected extension slash commands out of normal chat sends', async () => {
    invokeExtensionMock.mockResolvedValue({
      ok: false,
      error: {
        code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_CAPABILITY,
        message: 'Capability is not supported.',
      },
      audit: {
        extensionId: 'sample-extension',
        contributionId: 'sample.run',
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
        scope: { kind: 'session', projectPath: PROJECT_PATH, sessionId: SESSION_ID },
        outcome: OPENWAGGLE_EXTENSION_BROKER.OUTCOME.REJECTED,
        timestamp: 1,
        failureCode: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_CAPABILITY,
      },
    })
    const params = sendWorkflowParams()
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle(payload('/sample.run')))

    expect(params.showToast).toHaveBeenCalledWith('Capability is not supported.')
    expect(params.handleSend).not.toHaveBeenCalled()
  })

  it('releases images consumed by a command but keeps custom-summary draft images', async () => {
    const image = {
      id: 'image-copy',
      kind: 'image' as const,
      origin: 'session-resource' as const,
      name: 'diagram.png',
      path: '/tmp/resource-diagram.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      extractedText: '',
    }
    const params = sendWorkflowParams()
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await act(() => result.current.sendWithWaggle({ ...payload('/fork'), attachments: [image] }))
    expect(discardPreparedAttachment).toHaveBeenCalledExactlyOnceWith(image)

    useBranchSummaryStore.getState().openPrompt({
      sessionId: SESSION_ID,
      sourceNodeId: SessionNodeId('source-node'),
      restoreSelection: { branchId: null, nodeId: null },
      previousComposerText: '',
      draftComposerText: '',
    })
    useBranchSummaryStore.getState().startCustomPrompt('Summarize briefly')
    await act(() =>
      result.current.sendWithWaggle({ ...payload('Summarize briefly'), attachments: [image] }),
    )
    expect(params.branchSummary.materializeBranchSummary).toHaveBeenCalledWith('Summarize briefly')
    expect(discardPreparedAttachment).toHaveBeenCalledTimes(1)
  })

  it('refuses branch preflight without consuming the image or starting a run', async () => {
    const params = sendWorkflowParams({
      branchSummary: {
        ...sendWorkflowParams().branchSummary,
        materializeDraftBranchForSend: vi.fn().mockResolvedValue(false),
      },
    })
    const { result } = renderHook(() => useChatSendWorkflow(params))

    await expect(
      act(() => result.current.sendWithWaggle(payload('Keep this draft'))),
    ).rejects.toBeInstanceOf(MessageNotDelivered)
    expect(params.handleSend).not.toHaveBeenCalled()
    expect(discardPreparedAttachment).not.toHaveBeenCalled()
  })
})
