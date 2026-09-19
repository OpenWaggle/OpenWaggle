import { useState } from 'react'
import { insertComposerInvocation } from '@/features/composer/lib'
import { useComposerActionStore } from '@/features/composer/state'
import { useCombinedVcsStatus, useStackedGitActions } from '@/features/git'
import { useGit } from '@/features/git/hooks'
import { useTerminalCommands } from '@/features/terminal'
import { useUIStore } from '@/shell/ui-store'
import { useSessionResourceCatalog } from '../hooks/useSessionResources'
import {
  resolveSessionSummaryGitAction,
  type SessionSummaryGitAction,
} from '../model/session-summary-git-action'
import type { SessionSummaryHubInput } from './session-summary-hub-types'
import {
  usePersistedSummaryDisclosure,
  useSessionSummaryPanelLifecycle,
} from './use-session-summary-panel-lifecycle'

const SESSION_SUMMARY_RESOURCE_PAGE_SIZE = 6
const SESSION_SUMMARY_CHANGE_REQUEST_PAGE_SIZE = 50

function runSessionQuickAction(input: {
  readonly quickAction: SessionSummaryGitAction
  readonly openCommand: () => void
  readonly refreshStatus: () => void
}) {
  if (input.quickAction.disabled) return
  if (input.quickAction.kind === 'refresh_status') {
    input.refreshStatus()
    return
  }
  if (input.quickAction.kind === 'run_action') input.openCommand()
}

function useSessionSummaryGitController(input: SessionSummaryHubInput, panelVisible: boolean) {
  const [composerOpen, setComposerOpen] = useState(false)
  const [commitCommandOpen, setCommitCommandOpen] = useState(false)
  const showToast = useUIStore((state) => state.showToast)
  const { toggleTerminal } = useTerminalCommands()
  const diffRefreshKey = useUIStore((state) => state.diffRefreshKey)
  const git = useGit()
  const branchesMatchRepository =
    git.repositoryPath !== null && git.branchesRepositoryPath === git.repositoryPath
  const branches = branchesMatchRepository ? (git.branches?.branches ?? []) : []
  const vcsVisible = panelVisible || composerOpen || commitCommandOpen
  const combined = useCombinedVcsStatus(
    vcsVisible ? git.workingPath : null,
    `${String(input.messageCount)}:${String(diffRefreshKey)}`,
  )
  const stackedActions = useStackedGitActions({
    workingPath: git.workingPath,
    sessionId: input.session?.id,
    onCompleted: () => {
      void combined.refresh()
      if (git.workingPath) void git.refreshStatus(git.workingPath)
    },
  })
  const quickAction = resolveSessionSummaryGitAction(
    combined.status,
    stackedActions.isRunning,
    combined.localState,
    git.status?.ahead ?? 0,
  )

  const refreshGitStatus = () => {
    if (git.workingPath) void git.refreshStatus(git.workingPath)
    void combined.refresh()
  }

  const openCommitCommand = () => {
    setCommitCommandOpen(true)
    if (!git.status && !git.isLoading) refreshGitStatus()
  }

  const selectBranch = async (branch: string) => {
    if (!git.workingPath || !git.repositoryPath) return false
    const result = await git.checkoutBranch(git.workingPath, git.repositoryPath, { name: branch })
    showToast(result.message, result.ok ? 'success' : 'error')
    if (result.ok) void combined.refresh()
    return result.ok
  }
  const createBranch = async (branch: string) => {
    if (!git.workingPath || !git.repositoryPath) return false
    const result = await git.createBranch(git.workingPath, git.repositoryPath, {
      name: branch,
      checkout: true,
    })
    showToast(result.message, result.ok ? 'success' : 'error')
    if (result.ok) void combined.refresh()
    return result.ok
  }
  const completeChangeRequest = () => {
    void combined.refresh()
    if (git.workingPath) void git.refreshStatus(git.workingPath)
  }
  return {
    environment: {
      environmentMode: input.session?.environmentMode ?? 'local',
      workingPath: git.workingPath,
      gitStatus: git.status,
      vcsStatus: combined.status,
      remoteVcsState: combined.remoteState,
      localVcsState: combined.localState,
      branches,
      branchBusy: git.isBranchActionRunning,
      branchError: git.error,
      onOpenDiff: input.onOpenDiff,
      onCreateChangeRequest: () => setComposerOpen(true),
      onViewChangeRequest: input.onOpenChangeRequest ?? (() => {}),
      onToggleTerminal: toggleTerminal,
      onRefreshBranches: () => void git.refreshBranches(git.repositoryPath),
      onRefreshVcsStatus: () => void combined.refresh(),
      onSelectBranch: selectBranch,
      onCreateBranch: createBranch,
      quickAction,
      onQuickAction: () =>
        runSessionQuickAction({
          quickAction,
          openCommand: openCommitCommand,
          refreshStatus: () => void combined.refresh(),
        }),
    },
    dialogs: {
      composerOpen,
      closeComposer: () => setComposerOpen(false),
      completeChangeRequest,
      workingPath: git.workingPath,
      gitStatus: git.status,
      gitStatusError: git.statusError,
      refreshGitStatus,
      vcsStatus: combined.status,
      remoteVcsState: combined.remoteState,
      branches,
      commitCommandOpen,
      commitCommandRunning: stackedActions.isRunning,
      commitCommandProgress: stackedActions.progress,
      closeCommitCommand: () => setCommitCommandOpen(false),
      runCommitCommand: stackedActions.run,
      cancelCommitCommand: stackedActions.cancel,
    },
  }
}

function useSessionSummaryResourceController(
  sessionId: string,
  hasSession: boolean,
  activeBranchId: string | null,
  activePathNodeIds: readonly string[],
  summaryVisible: boolean,
) {
  const requestFilePicker = useComposerActionStore((state) => state.requestFilePicker)
  const openResourceViewer = useUIStore((state) => state.openResourceViewer)
  const sources = useSessionResourceCatalog(hasSession ? sessionId : null, 'sources', {
    activeBranchId,
    enabled: summaryVisible,
    pageSize: SESSION_SUMMARY_RESOURCE_PAGE_SIZE,
    pathNodeIds: activePathNodeIds,
  })
  const outputs = useSessionResourceCatalog(hasSession ? sessionId : null, 'outputs', {
    activeBranchId,
    enabled: summaryVisible,
    pageSize: SESSION_SUMMARY_RESOURCE_PAGE_SIZE,
    pathNodeIds: activePathNodeIds,
  })
  const changeRequests = useSessionResourceCatalog(
    hasSession ? sessionId : null,
    'change-requests',
    {
      activeBranchId,
      enabled: summaryVisible,
      pageSize: SESSION_SUMMARY_CHANGE_REQUEST_PAGE_SIZE,
      pathNodeIds: activePathNodeIds,
    },
  )
  const all = [
    ...new Map(
      [...sources.resources, ...outputs.resources].map((item) => [item.id, item]),
    ).values(),
  ]

  return {
    all,
    changeRequests: changeRequests.resources,
    failed: sources.isError || outputs.isError || changeRequests.isError,
    retry: () => {
      void sources.refetch()
      void outputs.refetch()
      void changeRequests.refetch()
    },
    outputs: outputs.resources,
    outputCount: outputs.total,
    sources: sources.resources,
    sourceCount: sources.total,
    openImage: (resourceId: string) => openResourceViewer(sessionId, resourceId),
    attachSource: () => requestFilePicker(sessionId),
    referenceSource: () => insertComposerInvocation('@'),
  }
}

export function useSessionSummaryHubController(input: SessionSummaryHubInput) {
  const sessionId = input.session ? String(input.session.id) : 'none'
  const panel = useSessionSummaryPanelLifecycle(input, sessionId)
  const subscriptions = usePersistedSummaryDisclosure(sessionId, 'subscriptions', true)
  const environment = usePersistedSummaryDisclosure(sessionId, 'environment', true)
  const changeRequests = usePersistedSummaryDisclosure(sessionId, 'change-requests', true)
  const outputs = usePersistedSummaryDisclosure(sessionId, 'outputs', false)
  const sources = usePersistedSummaryDisclosure(sessionId, 'sources', false)
  const git = useSessionSummaryGitController(input, panel.visible)
  const resources = useSessionSummaryResourceController(
    sessionId,
    input.session !== null,
    input.activeBranchId ?? null,
    input.activePathNodeIds ?? [],
    panel.visible,
  )

  return {
    sessionId,
    panel,
    disclosures: { subscriptions, environment, changeRequests, outputs, sources },
    git,
    resources,
  }
}

export type SessionSummaryHubController = ReturnType<typeof useSessionSummaryHubController>
