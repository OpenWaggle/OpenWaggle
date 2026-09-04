import type { GitStackedAction } from '@shared/types/git'
import { useState } from 'react'
import { useCombinedVcsStatus, useStackedGitActions } from '@/features/git'
import { useGit } from '@/features/git/hooks'
import { useUIStore } from '@/shell/ui-store'
import { useSessionResources } from '../hooks/useSessionResources'
import {
  resolveSessionSummaryGitAction,
  type SessionSummaryGitAction,
} from '../model/session-summary-git-action'
import type { SessionSummaryHubInput } from './session-summary-hub-types'
import {
  usePersistedSummaryDisclosure,
  useSessionSummaryPanelLifecycle,
} from './use-session-summary-panel-lifecycle'

function runSessionQuickAction(input: {
  readonly quickAction: SessionSummaryGitAction
  readonly run: (action: GitStackedAction) => unknown
  readonly openCommitDialog: (action: GitStackedAction) => void
}) {
  if (input.quickAction.kind === 'show_hint') return
  const action = input.quickAction.action
  if (!action) return
  if (action === 'commit' || action === 'commit_push') {
    input.openCommitDialog(action)
    return
  }
  void input.run(action)
}

function useSessionSummaryGitController(input: SessionSummaryHubInput) {
  const [composerOpen, setComposerOpen] = useState(false)
  const [pendingCommitAction, setPendingCommitAction] = useState<GitStackedAction | null>(null)
  const showToast = useUIStore((state) => state.showToast)
  const toggleTerminal = useUIStore((state) => state.toggleTerminal)
  const git = useGit()
  const combined = useCombinedVcsStatus(git.workingPath, input.messageCount)
  const stackedActions = useStackedGitActions({
    workingPath: git.workingPath,
    sessionId: input.session?.id,
    onCompleted: () => {
      void combined.refresh()
      if (git.workingPath) void git.refreshStatus(git.workingPath)
    },
  })
  const quickAction = resolveSessionSummaryGitAction(combined.status, stackedActions.isRunning)

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
  const confirmCommit = (commitMessage: string) => {
    const action = pendingCommitAction
    setPendingCommitAction(null)
    if (!action) return
    void stackedActions.run(action, {
      commitMessage,
      paths: git.status?.changedFiles.map((file) => file.path) ?? [],
    })
  }

  return {
    environment: {
      environmentMode: input.session?.environmentMode ?? 'local',
      workingPath: git.workingPath,
      gitStatus: git.status,
      vcsStatus: combined.status,
      branches: git.branches?.branches ?? [],
      branchBusy: git.isBranchActionRunning,
      branchError: git.error,
      onOpenDiff: input.onOpenDiff,
      onCreateChangeRequest: () => setComposerOpen(true),
      onToggleTerminal: toggleTerminal,
      onRefreshBranches: () => void git.refreshBranches(git.repositoryPath),
      onSelectBranch: selectBranch,
      onCreateBranch: createBranch,
      quickAction,
      onQuickAction: () =>
        runSessionQuickAction({
          quickAction,
          run: stackedActions.run,
          openCommitDialog: setPendingCommitAction,
        }),
    },
    dialogs: {
      composerOpen,
      closeComposer: () => setComposerOpen(false),
      completeChangeRequest,
      workingPath: git.workingPath,
      gitStatus: git.status,
      vcsStatus: combined.status,
      commitOpen: pendingCommitAction !== null,
      commitFileCount: git.status?.filesChanged ?? 0,
      cancelCommit: () => setPendingCommitAction(null),
      confirmCommit,
    },
  }
}

function useSessionSummaryResourceController(sessionId: string, hasSession: boolean) {
  const openResourceViewer = useUIStore((state) => state.openResourceViewer)
  const openCommandSurface = useUIStore((state) => state.openCommandSurface)
  const resources = useSessionResources(hasSession ? sessionId : null)
  const all = resources.data ?? []

  return {
    all,
    failed: resources.isError,
    retry: () => void resources.refetch(),
    outputs: all.filter((resource) => resource.isOutput),
    sources: all.filter((resource) => resource.isSource),
    openImage: (resourceId: string) => openResourceViewer(sessionId, resourceId),
    addSource: () => openCommandSurface('files'),
  }
}

export function useSessionSummaryHubController(input: SessionSummaryHubInput) {
  const sessionId = input.session ? String(input.session.id) : 'none'
  const panel = useSessionSummaryPanelLifecycle(input, sessionId)
  const subscriptions = usePersistedSummaryDisclosure(sessionId, 'subscriptions', true)
  const environment = usePersistedSummaryDisclosure(sessionId, 'environment', true)
  const outputs = usePersistedSummaryDisclosure(sessionId, 'outputs', false)
  const sources = usePersistedSummaryDisclosure(sessionId, 'sources', false)
  const git = useSessionSummaryGitController(input)
  const resources = useSessionSummaryResourceController(sessionId, input.session !== null)

  return {
    sessionId,
    panel,
    disclosures: { subscriptions, environment, outputs, sources },
    git,
    resources,
  }
}

export type SessionSummaryHubController = ReturnType<typeof useSessionSummaryHubController>
