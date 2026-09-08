import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import type { SessionDetail } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import type { QueryClient } from '@tanstack/react-query'
import type { RenderResult } from '@testing-library/react'
import { type Mock, vi } from 'vitest'
import { useComposerActionStore, useComposerStore } from '@/features/composer/state'
import type {
  useCombinedVcsStatus as useCombinedVcsStatusHook,
  useStackedGitActions as useStackedGitActionsHook,
} from '@/features/git'
import type { useGit as useGitHook } from '@/features/git/hooks'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import type { SessionResourceBrowserTarget } from '../../model/session-resource-browser'
import { useSessionSummaryUIStore } from '../../state/session-summary-ui-store'
import { SessionSummaryHub } from '../SessionSummaryHub'
import { SESSION_SUMMARY_SECTION_ORDER } from '../SessionSummaryPanelSections'

const mocks = vi.hoisted(() => ({
  listSessionResources: vi.fn<OpenWaggleApi['listSessionResources']>(),
  listArchivedSessions: vi.fn(),
  listMcpEventSubscriptions: vi.fn(),
  useStackedGitActions: vi.fn<typeof useStackedGitActionsHook>(),
  useCombinedVcsStatus: vi.fn<typeof useCombinedVcsStatusHook>(),
  useGit: vi.fn<typeof useGitHook>(),
  commitOrPushDialog: vi.fn(() => null),
}))

export const listSessionResources: Mock<OpenWaggleApi['listSessionResources']> =
  mocks.listSessionResources
export const useStackedGitActions: Mock<typeof useStackedGitActionsHook> =
  mocks.useStackedGitActions
export const useCombinedVcsStatus: Mock<typeof useCombinedVcsStatusHook> =
  mocks.useCombinedVcsStatus
export const useGit: Mock<typeof useGitHook> = mocks.useGit
export const commitOrPushDialog = mocks.commitOrPushDialog

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources: mocks.listSessionResources,
    listArchivedSessions: mocks.listArchivedSessions,
    listMcpEventSubscriptions: mocks.listMcpEventSubscriptions,
    getSessionHiveRelations: vi
      .fn()
      .mockResolvedValue({ current: null, parent: null, workers: [] }),
    openExternal: vi.fn(),
  },
}))

vi.mock('@/features/git/hooks', () => ({
  useGit: mocks.useGit,
}))

vi.mock('@/features/git', () => ({
  CommitOrPushDialog: mocks.commitOrPushDialog,
  CommitMessageDialog: () => null,
  resolveQuickAction: () => ({
    label: 'Commit & push',
    disabled: false,
    kind: 'run_action',
    action: 'commit_push',
  }),
  useStackedGitActions: mocks.useStackedGitActions,
  useCombinedVcsStatus: mocks.useCombinedVcsStatus,
}))

export function session(id = 'session-1'): SessionDetail {
  return {
    id: SessionId(id),
    title: `Session ${id}`,
    projectPath: '/project',
    messages: [],
    environmentMode: 'local',
    createdAt: 1000,
    updatedAt: 1000,
  }
}

export function resource(overrides: Partial<SessionResource>): SessionResource {
  return {
    id: 'resource-1',
    sessionId: SessionId('session-1'),
    canonicalKey: 'sha256:image',
    kind: 'image',
    title: 'reference.png',
    mimeType: 'image/png',
    locator: 'session-resource://resource-1',
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
    managed: overrides.managed ?? true,
  }
}

export function gitState(
  overrides: Partial<ReturnType<typeof useGitHook>> = {},
): ReturnType<typeof useGitHook> {
  return {
    workingPath: WorkingPath('/project'),
    repositoryPath: RepositoryPath('/project'),
    status: {
      branch: 'codex/session-summary-resource-hub',
      filesChanged: 2,
      additions: 12,
      deletions: 3,
      changedFiles: [],
      clean: false,
      ahead: 0,
      behind: 0,
    },
    isLoading: false,
    statusError: null,
    error: null,
    branches: null,
    branchesRepositoryPath: null,
    isLoadingBranches: false,
    isCommitting: false,
    isBranchActionRunning: false,
    refreshStatus: vi.fn(),
    refreshBranches: vi.fn(),
    commit: vi.fn(),
    checkoutBranch: vi.fn(),
    createBranch: vi.fn(),
    ...overrides,
  }
}

type HubProps = {
  readonly activeSession?: SessionDetail | null
  readonly messageCount?: number
  readonly autoHidden?: boolean
  readonly rightSidebarOpen?: boolean
  readonly onOpenResources?: (target: SessionResourceBrowserTarget) => void
}

export function hubElement(props: HubProps = {}, includeHeaderToggle = false) {
  return (
    <>
      {includeHeaderToggle ? (
        <Button
          id="session-summary-session-1-toggle"
          type="button"
          onClick={() => useSessionSummaryUIStore.getState().togglePanel('session-1')}
        >
          Session Summary toggle
        </Button>
      ) : null}
      <SessionSummaryHub
        key={props.activeSession?.id ?? 'none'}
        input={{
          session: props.activeSession === undefined ? session() : props.activeSession,
          messageCount: props.messageCount ?? 1,
          autoHidden: props.autoHidden ?? false,
          rightSidebarOpen: props.rightSidebarOpen ?? false,
          onOpenDiff: vi.fn(),
          onOpenResources: props.onOpenResources ?? vi.fn(),
          onNavigateSession: vi.fn(),
          extensionRegistry: null,
          extensionProjectPaths: ['/project'],
        }}
      />
    </>
  )
}

export function renderHub(
  props: HubProps = {},
  includeHeaderToggle = false,
): RenderResult & { readonly client: QueryClient } {
  return renderWithQueryClient(hubElement(props, includeHeaderToggle))
}

export function sessionSummarySectionOrder() {
  return SESSION_SUMMARY_SECTION_ORDER
}

export function setupSessionSummaryHubHarness() {
  localStorage.clear()
  useSessionSummaryUIStore.setState({ panels: {} })
  useUIStore.setState({ resourceViewer: null })
  useComposerActionStore.setState(useComposerActionStore.getInitialState())
  useComposerStore.setState(useComposerStore.getInitialState())
  listSessionResources.mockReset().mockResolvedValue({
    resources: [],
    backfillComplete: true,
  })
  mocks.listArchivedSessions.mockReset().mockResolvedValue([])
  mocks.listMcpEventSubscriptions.mockReset().mockResolvedValue([])
  mocks.useGit.mockReset().mockReturnValue(gitState())
  useStackedGitActions.mockReset().mockReturnValue({
    isRunning: false,
    progress: null,
    run: vi.fn(),
    cancel: vi.fn(),
  })
  useCombinedVcsStatus.mockReset().mockReturnValue({
    local: null,
    localState: 'loaded',
    remote: null,
    remoteState: 'loaded',
    status: {
      isRepo: true,
      sourceControlProvider: { id: 'github', host: 'github.com' },
      hasPrimaryRemote: true,
      refName: 'codex/session-summary-resource-hub',
      defaultRef: 'main',
      isDefaultRef: false,
      pushTargetRef: 'codex/session-summary-resource-hub',
      pushTargetIsDefaultRef: false,
      hasWorkingTreeChanges: true,
      workingTree: { files: [], insertions: 12, deletions: 3 },
      hasUpstream: true,
      aheadCount: 1,
      behindCount: 0,
      aheadOfDefaultCount: 1,
      changeRequest: null,
    },
    refresh: vi.fn(),
  })
  commitOrPushDialog.mockClear()
}
