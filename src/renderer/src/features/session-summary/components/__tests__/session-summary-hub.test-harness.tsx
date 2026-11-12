import type { ActionRun } from '@shared/types/action-runs'
import { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import type { VcsStatus } from '@shared/types/git'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import type { SessionDetail } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
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
  actionRuns: new Array<ActionRun>(),
  toggleTerminal: vi.fn(),
  listSessionResources: vi.fn<OpenWaggleApi['listSessionResources']>(),
  listArchivedSessions: vi.fn(),
  useStackedGitActions: vi.fn<typeof useStackedGitActionsHook>(),
  useCombinedVcsStatus: vi.fn<typeof useCombinedVcsStatusHook>(),
  useGit: vi.fn<typeof useGitHook>(),
  commitOrPushDialog: vi.fn(() => null),
  openExternal: vi.fn<OpenWaggleApi['openExternal']>(),
  getChangeRequestOpenDestination: vi.fn<OpenWaggleApi['getChangeRequestOpenDestination']>(),
  refreshSourceControlStatus: vi.fn<OpenWaggleApi['refreshSourceControlStatus']>(),
  invalidateVcsStatus: vi.fn<(workingPath: string) => Promise<void>>(),
}))

export const listSessionResources: Mock<OpenWaggleApi['listSessionResources']> =
  mocks.listSessionResources
export function setActionRuns(runs: ActionRun[]) {
  mocks.actionRuns = runs
}
export const useStackedGitActions: Mock<typeof useStackedGitActionsHook> =
  mocks.useStackedGitActions
export const useCombinedVcsStatus: Mock<typeof useCombinedVcsStatusHook> =
  mocks.useCombinedVcsStatus
export const useGit: Mock<typeof useGitHook> = mocks.useGit
export const commitOrPushDialog = mocks.commitOrPushDialog
export const toggleSessionTerminal: Mock<() => void> = mocks.toggleTerminal
export const openExternal: Mock<OpenWaggleApi['openExternal']> = mocks.openExternal
export const getChangeRequestOpenDestination: Mock<
  OpenWaggleApi['getChangeRequestOpenDestination']
> = mocks.getChangeRequestOpenDestination
export const invalidateVcsStatus: Mock<(workingPath: string) => Promise<void>> =
  mocks.invalidateVcsStatus
export const refreshSourceControlStatus: Mock<OpenWaggleApi['refreshSourceControlStatus']> =
  mocks.refreshSourceControlStatus

// The Hub asks to toggle the Session terminal; useTerminalCommands.component.test.tsx covers it.
vi.mock('@/features/terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/terminal')>()),
  useTerminalCommands: () => ({ toggleTerminal: mocks.toggleTerminal }),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    manageProjectActions: vi.fn<OpenWaggleApi['manageProjectActions']>(async ({ operation }) => {
      if (operation.type === 'runs') return { type: 'runs', runs: mocks.actionRuns }
      if (operation.type === 'preparation') return { type: 'preparation', preparation: null }
      return {
        type: 'catalog',
        catalog: { revision: 'test', actions: [], profiles: [], preparation: [] },
      }
    }),
    listSessionResources: mocks.listSessionResources,
    ...(
      await import('@/features/session-summary/hooks/__tests__/session-resource-catalog.fake')
    ).sessionResourceCatalogOver(mocks.listSessionResources),
    listArchivedSessions: mocks.listArchivedSessions,
    getSessionHiveRelations: vi
      .fn()
      .mockResolvedValue({ current: null, parent: null, workers: [] }),
    openExternal: mocks.openExternal,
    getChangeRequestOpenDestination: mocks.getChangeRequestOpenDestination,
    refreshSourceControlStatus: mocks.refreshSourceControlStatus,
  }),
}))

// Git status polling is another feature; the Hub tests drive the status it shows through this.
vi.mock('@/features/git/hooks', () => ({
  useGit: mocks.useGit,
}))

// The commit and push dialogs run Git operations; their own tests cover them.
vi.mock('@/features/git/components', () => ({
  CommitOrPushDialog: mocks.commitOrPushDialog,
  CommitOrPushStatusDialog: () => null,
  CommitMessageDialog: () => null,
}))

// See '@/features/git/hooks' above: the combined VCS status and stacked actions are Git's.
vi.mock('@/features/git', () => ({
  resolveQuickAction: () => ({
    label: 'Commit & push',
    disabled: false,
    kind: 'run_action',
    action: 'commit_push',
  }),
  useStackedGitActions: mocks.useStackedGitActions,
  useCombinedVcsStatus: mocks.useCombinedVcsStatus,
  invalidateVcsStatus: mocks.invalidateVcsStatus,
}))

export function session(id = 'session-1') {
  const detail: SessionDetail = {
    id: SessionId(id),
    title: `Session ${id}`,
    projectPath: '/project',
    messages: [],
    environmentMode: 'local',
    createdAt: 1000,
    updatedAt: 1000,
  }
  return detail
}

export function resource(overrides: Partial<SessionResource>) {
  const result: SessionResource = {
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
  return result
}

export function gitState(overrides: Partial<ReturnType<typeof useGitHook>> = {}) {
  const result: ReturnType<typeof useGitHook> = {
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
  return result
}

interface HubProps {
  readonly activeSession?: SessionDetail | null
  readonly messageCount?: number
  readonly hiveAvailable?: boolean
  readonly autoHidden?: boolean
  readonly rightSidebarOpen?: boolean
  readonly onOpenResources?: (target: SessionResourceBrowserTarget) => void
  readonly onOpenChangeRequest?: (url: string) => void
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
          hiveAvailable: props.hiveAvailable ?? false,
          autoHidden: props.autoHidden ?? false,
          rightSidebarOpen: props.rightSidebarOpen ?? false,
          onOpenDiff: vi.fn(),
          onOpenResources: props.onOpenResources ?? vi.fn(),
          ...(props.onOpenChangeRequest ? { onOpenChangeRequest: props.onOpenChangeRequest } : {}),
          extensionRegistry: null,
          extensionProjectPaths: ['/project'],
        }}
      />
    </>
  )
}

export function renderHub(props: HubProps = {}, includeHeaderToggle = false) {
  return renderWithQueryClient(hubElement(props, includeHeaderToggle))
}

export function sessionSummarySectionOrder() {
  return SESSION_SUMMARY_SECTION_ORDER
}

/** The Git status every Session Summary Hub test starts from. */
export function hubVcsStatus() {
  const status: VcsStatus = {
    isRepo: true,
    sourceControlProvider: { id: 'github', host: 'github.com' },
    sourceControlHost: { host: 'github.com', provider: 'github', source: 'public-host' },
    sourceControlAttention: null,
    sourceControlRepositoryUrl: null,
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
    changeRequestAttention: null,
    changeRequestAccount: null,
  }
  return status
}

export function setupSessionSummaryHubHarness() {
  mocks.actionRuns = []
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
  mocks.openExternal.mockReset().mockResolvedValue(undefined)
  mocks.getChangeRequestOpenDestination
    .mockReset()
    .mockResolvedValue({ destination: 'inspector', source: 'default' })
  mocks.refreshSourceControlStatus.mockReset().mockResolvedValue(undefined)
  mocks.invalidateVcsStatus.mockReset().mockResolvedValue(undefined)
  mocks.useGit.mockReset().mockReturnValue(gitState())
  useStackedGitActions.mockReset().mockReturnValue({
    isRunning: false,
    progress: null,
    run: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
  })
  useCombinedVcsStatus.mockReset().mockReturnValue({
    local: null,
    localState: 'loaded',
    remote: null,
    remoteState: 'loaded',
    status: hubVcsStatus(),
    refresh: vi.fn(),
  })
  commitOrPushDialog.mockClear()
  toggleSessionTerminal.mockClear()
}
