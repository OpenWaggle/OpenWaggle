import type { CodeViewHandle } from '@pierre/diffs/react'
import type { RepositoryPath, SessionId, WorkingPath } from '@shared/types/brand'
import type { GitStackedAction, GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import type { TurnCheckpointSummary } from '@shared/types/turn-diff'
import { useRef, useState } from 'react'
import { useDiffPanelGitActions } from '@/features/diff-panel/hooks/useDiffPanelGitActions'
import type { ReviewAnnotationMetadata } from '@/features/diff-panel/lib/code-view-items'
import { codeViewItemId } from '@/features/diff-panel/lib/code-view-items'
import {
  selectThreadDiffScopeSelection,
  useDiffScopeStore,
} from '@/features/diff-panel/state/diff-scope-store'
import { CommitMessageDialog, useCombinedVcsStatus, useStackedGitActions } from '@/features/git'
import { useGit } from '@/features/git/hooks'
import { ChangeRequestComposer } from '@/features/session-summary'
import { useUIStore } from '@/shell/ui-store'
import { useBaseRefChoices } from '../hooks/useBaseRefChoices'
import { type CommitPaths, useCommitPaths } from '../hooks/useCommitPaths'
import { useDisplayedDiff } from '../hooks/useDisplayedDiff'
import { useReconcileTurnSelection } from '../hooks/useReconcileTurnSelection'
import { useReviewKey } from '../hooks/useReviewKey'
import { useSessionTurns } from '../hooks/useSessionTurns'
import { DiffBottomBar } from './DiffBottomBar'
import { DiffPanelHeader } from './DiffPanelHeader'
import { DiffReviewBody } from './DiffReviewBody'

interface DiffPanelProps {
  session?: SessionDetail | null
  workingPath: WorkingPath | null
  repositoryPath: RepositoryPath | null
  sessionId?: SessionId | null
  onSendMessage: (content: string) => void | Promise<void>
  /**
   * Bumped when the diff should be reloaded.
   *
   * Refresh used to remount this panel via `key=`, which discarded every piece of panel-local
   * state: the scroll position in a long diff, the navigator's collapsed folders, the line
   * selection, and a commit message the user was part-way through typing. Refreshes fire on every
   * turn end, every working-tree broadcast and every window focus, so that was routine.
   */
  refreshToken?: number
}

/** Switching to Turns means the latest captured turn, which the tabs do not know about. */
function selectScope(input: {
  readonly scope: 'branch' | 'unstaged' | 'turn'
  readonly scopeKey: string
  readonly turns: readonly TurnCheckpointSummary[]
  readonly selectTurn: (scopeKey: string, turnId: string) => void
  readonly selectGitScope: (scopeKey: string, scope: 'branch' | 'unstaged') => void
}) {
  if (input.scope === 'turn') {
    const latestTurn = input.turns.at(-1)
    if (latestTurn) input.selectTurn(input.scopeKey, latestTurn.turnId)
    return
  }
  input.selectGitScope(input.scopeKey, input.scope)
}

const NOTHING_TO_COMMIT_MESSAGE = 'No changes in this working tree to commit.'
const STILL_READING_MESSAGE = 'Still reading this working tree - try again in a moment.'

/**
 * Dispatch a quick action, collecting a commit message first when one is needed.
 *
 * Nothing to commit is reported rather than dispatched: an empty set produced a `nothing-to-commit`
 * failure whose message blamed the user for not selecting files, with no dialog shown - an enabled
 * button that silently did nothing.
 */
export function requestStackedAction(input: {
  readonly action: GitStackedAction
  readonly commitPaths: CommitPaths
  readonly run: (action: GitStackedAction, options?: { paths: readonly string[] }) => void
  readonly showToast: (message: string, variant: 'error') => void
  readonly onNeedsMessage: (action: GitStackedAction) => void
  readonly onCreateChangeRequest: () => void
}) {
  if (input.action === 'create_pr' || input.action === 'commit_push_pr') {
    input.onCreateChangeRequest()
    return
  }
  if (!input.action.startsWith('commit')) {
    input.run(input.action, { paths: input.commitPaths.paths })
    return
  }
  // A tree that could not be read - or has not been read yet - is not a clean tree.
  if (input.commitPaths.error !== null) {
    input.showToast(`Could not read this working tree: ${input.commitPaths.error}`, 'error')
    return
  }
  if (input.commitPaths.isLoading) {
    input.showToast(STILL_READING_MESSAGE, 'error')
    return
  }
  if (input.commitPaths.paths.length === 0) input.showToast(NOTHING_TO_COMMIT_MESSAGE, 'error')
  else input.onNeedsMessage(input.action)
}

/** Open a change request in the user's browser, never in an Electron window. */
function openChangeRequestUrl(url: string | undefined) {
  if (url) window.open(url, '_blank', 'noopener')
}

interface DiffPanelDialogsInput {
  readonly session: SessionDetail | null
  readonly workingPath: WorkingPath | null
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly commitPaths: CommitPaths
  readonly pendingCommitAction: GitStackedAction | null
  readonly changeRequestOpen: boolean
  readonly setPendingCommitAction: (action: GitStackedAction | null) => void
  readonly setChangeRequestOpen: (open: boolean) => void
  readonly run: (
    action: GitStackedAction,
    options?: { readonly paths?: readonly string[]; readonly commitMessage?: string },
  ) => void
  readonly onCompleted: () => void
}

function DiffPanelDialogs({ input }: { readonly input: DiffPanelDialogsInput }) {
  return (
    <>
      <CommitMessageDialog
        open={input.pendingCommitAction !== null}
        fileCount={input.commitPaths.changedFileCount}
        onCancel={() => input.setPendingCommitAction(null)}
        onConfirm={(commitMessage) => {
          const action = input.pendingCommitAction
          input.setPendingCommitAction(null)
          if (action) input.run(action, { paths: input.commitPaths.paths, commitMessage })
        }}
      />
      {input.changeRequestOpen && input.session && input.workingPath ? (
        <ChangeRequestComposer
          session={input.session}
          workingPath={input.workingPath}
          gitStatus={input.gitStatus}
          vcsStatus={input.vcsStatus}
          onClose={() => input.setChangeRequestOpen(false)}
          onCompleted={input.onCompleted}
        />
      ) : null}
    </>
  )
}

function useDiffGitWorkflow(input: {
  readonly session: SessionDetail | null
  readonly sessionId: SessionId | null
  readonly workingPath: WorkingPath | null
  readonly refreshToken: number
  readonly refreshDiff: (workingPath: WorkingPath) => Promise<void>
  readonly showToast: (message: string, variant: 'error') => void
}) {
  const { status: vcsStatus, refresh: refreshVcsStatus } = useCombinedVcsStatus(
    input.workingPath,
    input.refreshToken,
  )
  const refreshAfterAction = () => {
    if (input.workingPath) void input.refreshDiff(input.workingPath)
    void refreshVcsStatus()
  }
  const stackedActions = useStackedGitActions({
    workingPath: input.workingPath,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    onCompleted: refreshAfterAction,
  })
  const git = useGit()
  const [pendingCommitAction, setPendingCommitAction] = useState<GitStackedAction | null>(null)
  const [changeRequestOpen, setChangeRequestOpen] = useState(false)
  const openChangeRequest = () => {
    if (!input.session || input.session.id !== input.sessionId || !input.workingPath) {
      input.showToast('Open this session before creating its change request.', 'error')
      return
    }
    setChangeRequestOpen(true)
  }
  return {
    vcsStatus,
    stackedActions,
    git,
    pendingCommitAction,
    setPendingCommitAction,
    changeRequestOpen,
    setChangeRequestOpen,
    openChangeRequest,
    refreshAfterAction,
  }
}

export function DiffPanel({
  session = null,
  workingPath,
  repositoryPath,
  sessionId = null,
  onSendMessage,
  refreshToken = 0,
}: DiffPanelProps) {
  const viewerRef = useRef<CodeViewHandle<ReviewAnnotationMetadata>>(null)
  const scopeByThreadKey = useDiffScopeStore((s) => s.byThreadKey)
  const selectGitScope = useDiffScopeStore((s) => s.selectGitScope)
  const selectBranchBaseRef = useDiffScopeStore((s) => s.selectBranchBaseRef)
  const selectTurn = useDiffScopeStore((s) => s.selectTurn)
  const scopeKey = sessionId ?? workingPath ?? ''

  const commitPaths = useCommitPaths(workingPath, refreshToken)
  const showToast = useUIStore((state) => state.showToast)
  const selection = selectThreadDiffScopeSelection(scopeByThreadKey, scopeKey || null)
  const branchBaseRef = selection.kind === 'branch' ? selection.baseRef : null
  const baseRefChoices = useBaseRefChoices(repositoryPath)
  const turns = useSessionTurns(sessionId, refreshToken)
  const displayed = useDisplayedDiff({ sessionId, workingPath, selection, refreshToken })
  const { reviewKey, keyForSession } = useReviewKey({ scopeKey, selection })
  const { fileDiffs, isLoading, loadError, refreshDiff } = displayed

  useReconcileTurnSelection(scopeKey, turns)

  const gitActions = useDiffPanelGitActions({
    workingPath,
    fallbackHasChanges: selection.kind === 'unstaged' && fileDiffs.length > 0,
    canMutateWorkingTree: selection.kind === 'unstaged',
    refreshDiff,
  })

  const workflow = useDiffGitWorkflow({
    session,
    sessionId,
    workingPath,
    refreshToken,
    refreshDiff,
    showToast,
  })

  /**
   * Commit-bearing actions must collect an explicit message first (review B2);
   * everything else dispatches immediately.
   */
  return (
    <div className="relative flex flex-col size-full bg-diff-bg">
      {workingPath ? (
        <DiffPanelHeader
          selection={selection}
          baseRefControl={{
            current: branchBaseRef,
            choices: baseRefChoices.choices,
            choicesLoaded: baseRefChoices.loaded,
            resolvedAutomatic: displayed.resolvedAutomaticBaseRef,
            fellBackToWorkingTree: displayed.automaticFellBackToWorkingTree,
            onChange: (baseRef) => selectBranchBaseRef(scopeKey, baseRef),
          }}
          turns={turns}
          onSelectScope={(scope) =>
            selectScope({ scope, scopeKey, turns, selectTurn, selectGitScope })
          }
          onSelectTurn={(turnId) => selectTurn(scopeKey, turnId)}
        />
      ) : null}
      <DiffReviewBody
        viewerRef={viewerRef}
        files={fileDiffs}
        isLoading={isLoading}
        loadError={loadError}
        onRetryLoad={displayed.retryLoad}
        onSendMessage={onSendMessage}
        onFileClick={(path) =>
          viewerRef.current?.scrollTo({ type: 'item', id: codeViewItemId(path), align: 'start' })
        }
        reviewKeys={{ reviewKey, keyForSession }}
      />
      <DiffBottomBar
        onRevertAll={gitActions.handleRevertAll}
        onStageAll={gitActions.handleStageAll}
        canRevertAll={gitActions.canRevertAll}
        canStageAll={gitActions.canStageAll}
        isActionRunning={gitActions.isActionRunning}
        quickAction={{
          status: workflow.vcsStatus,
          isBusy: workflow.stackedActions.isRunning,
          onRunAction: (action) =>
            requestStackedAction({
              action,
              commitPaths,
              run: workflow.stackedActions.run,
              showToast,
              onNeedsMessage: workflow.setPendingCommitAction,
              onCreateChangeRequest: workflow.openChangeRequest,
            }),
          onPull: () => workflow.stackedActions.run('pull'),
          onOpenChangeRequest: () => openChangeRequestUrl(workflow.vcsStatus?.changeRequest?.url),
          onPublish: () => workflow.stackedActions.run('push'),
        }}
      />
      <DiffPanelDialogs
        input={{
          session,
          workingPath,
          gitStatus: workflow.git.status,
          vcsStatus: workflow.vcsStatus,
          commitPaths,
          pendingCommitAction: workflow.pendingCommitAction,
          changeRequestOpen: workflow.changeRequestOpen,
          setPendingCommitAction: workflow.setPendingCommitAction,
          setChangeRequestOpen: workflow.setChangeRequestOpen,
          run: workflow.stackedActions.run,
          onCompleted: workflow.refreshAfterAction,
        }}
      />
    </div>
  )
}
