import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import { fromPartial } from '@total-typescript/shoehorn'
import { vi } from 'vitest'
import type { ChatPanelSections } from '../../model/chat-panel-sections'

export const PROJECT_PATH = '/test/project'

export function makeMessage(
  overrides: Partial<UIMessage> & { id: string; role: 'user' | 'assistant' },
): UIMessage {
  return fromPartial<UIMessage>({
    parts: [],
    ...overrides,
  })
}

/** Build a full ChatPanelSections for the panel under test, with focused overrides. */
export function createSections(
  overrides: Partial<ChatPanelSections['transcript']> = {},
  composerOverrides: Partial<ChatPanelSections['composer']> = {},
): ChatPanelSections {
  const transcript = {
    messages: [],
    isLoading: false,
    projectPath: PROJECT_PATH,
    recentProjects: [],
    activeSessionId: SessionId('session-1'),
    chatRows: [],
    extensionRegistry: null,
    extensionProjectPaths: [PROJECT_PATH],
    lastUserMessageId: null,
    streamSignalVersion: 0,
    userDidSend: false,
    onUserDidSendConsumed: vi.fn(),
    onOpenProject: vi.fn().mockResolvedValue(undefined),
    onSelectProjectPath: vi.fn(),
    onRetryText: vi.fn().mockResolvedValue(undefined),
    onOpenSettings: vi.fn(),
    onDismissError: vi.fn(),
    onDismissInterruptedRun: vi.fn(),
    onBranchFromMessage: vi.fn(),
    onForkFromMessage: vi.fn(),
    onViewTurnDiff: vi.fn(),
    turnAnchorMessageIds: new Set<string>(),
    ...overrides,
  }

  const workingPath = transcript.projectPath === null ? null : WorkingPath(transcript.projectPath)
  const repositoryPath =
    transcript.projectPath === null ? null : RepositoryPath(transcript.projectPath)

  return {
    transcript,
    composer: {
      activeSessionId: transcript.activeSessionId,
      session: null,
      isFirstMessage: false,
      waggleStatus: 'idle',
      commandPaletteOpen: false,
      slashSkills: [],
      forkSelectorOpen: false,
      forkTargets: [],
      isLoading: transcript.isLoading,
      status: transcript.isLoading ? 'streaming' : 'ready',
      compactionStatus: null,
      onStopCollaboration: vi.fn(),
      onSelectSkill: vi.fn(),
      onStartWaggle: vi.fn(),
      onSendWithWaggle: vi.fn().mockResolvedValue(undefined),
      onSteer: vi.fn().mockResolvedValue(undefined),
      onCancel: vi.fn(),
      onToast: vi.fn(),
      onSkipBranchSummary: vi.fn(),
      onSummarizeBranch: vi.fn(),
      onStartCustomBranchSummary: vi.fn(),
      onCancelBranchSummary: vi.fn(),
      onOpenForkSelector: vi.fn(),
      onCloseForkSelector: vi.fn(),
      onSelectForkTarget: vi.fn(),
      onCloneToNewSession: vi.fn(),
      ...composerOverrides,
    },
    diff: {
      workingPath,
      repositoryPath,
      sessionId: transcript.activeSessionId,
      onSendMessage: transcript.onRetryText,
    },
    agentInteractions: [],
    agentCustomMessages: [],
    agentInteractionEvents: [],
    extensionRegistry: transcript.extensionRegistry,
    extensionProjectPaths: transcript.extensionProjectPaths,
    onRespondAgentInteraction: vi.fn().mockResolvedValue(undefined),
  }
}
