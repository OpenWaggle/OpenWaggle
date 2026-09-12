import type {
  GitBranchValidationResult,
  GitRunStackedActionOptions,
  GitStackedAction,
} from '@shared/types/git'
import { resolveAutoFeatureBranchName } from '@shared/utils/git-stacked-action'
import type { KeyboardEvent } from 'react'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import {
  branchInfoName,
  type CommitBranchTarget,
  commitCommandStats,
  findBranchRefConflict,
  primaryCommitCommandAction,
  resolveCommitCommandActions,
} from '../lib/commit-or-push-model'
import type {
  CommitOrPushDialogController,
  CommitOrPushDialogProps,
  CommitOrPushRepositoryContext,
} from './commit-or-push-dialog-types'

type BranchValidation =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  | { readonly status: 'settled'; readonly result: GitBranchValidationResult }

interface PreparedBranchState {
  readonly name: string
  readonly previousRef: string | null
}

function repositoryBranchName(repository: CommitOrPushRepositoryContext) {
  if (repository.vcsStatus) return repository.vcsStatus.refName?.trim() || null
  const branch = repository.gitStatus.branch.trim()
  if (!branch || branch === 'HEAD' || branch.startsWith('detached@')) return null
  return branch
}

function currentBranchName(
  repository: CommitOrPushRepositoryContext,
  preparedBranch: PreparedBranchState | null,
) {
  return preparedBranch?.name ?? repositoryBranchName(repository)
}

function initialTarget(repository: CommitOrPushRepositoryContext): CommitBranchTarget {
  return repository.vcsStatus?.isDefaultRef || repositoryBranchName(repository) === null
    ? 'new'
    : 'current'
}

function initialBranchName(repository: CommitOrPushRepositoryContext) {
  return resolveAutoFeatureBranchName(
    repository.branches.map(branchInfoName),
    `codex/${repository.sessionTitle}`,
  )
}

function useBranchValidation(
  repository: CommitOrPushRepositoryContext,
  target: CommitBranchTarget,
  branchName: string,
) {
  const [validation, setValidation] = useState<BranchValidation>({ status: 'idle' })

  useEffect(() => {
    if (target === 'current') return
    const requested = branchName.trim()
    if (!requested) {
      setValidation({
        status: 'settled',
        result: { ok: false, code: 'required', message: 'Branch name is required.' },
      })
      return
    }
    const localConflict = findBranchRefConflict(repository.branches, requested)
    if (localConflict) {
      setValidation({
        status: 'settled',
        result: {
          ok: false,
          code: 'branch-exists',
          message: `Branch "${requested}" conflicts with existing ref "${localConflict}".`,
        },
      })
      return
    }
    let current = true
    setValidation({ status: 'checking' })
    void api
      .validateGitBranchName(repository.workingPath, requested)
      .then((result) => {
        if (current) setValidation({ status: 'settled', result })
      })
      .catch(() => {
        if (!current) return
        setValidation({
          status: 'settled',
          result: {
            ok: false,
            code: 'invalid-name',
            message: 'Branch validation failed. Try again.',
          },
        })
      })
    return () => {
      current = false
    }
  }, [branchName, repository.branches, repository.workingPath, target])

  return validation
}

function resolveBranchReadiness(
  currentRef: string | null,
  target: CommitBranchTarget,
  validation: BranchValidation,
) {
  if (target === 'current') {
    return {
      ready: currentRef !== null,
      reason: null,
    }
  }
  if (validation.status === 'checking') return { ready: false, reason: 'Checking the branch name.' }
  if (validation.status === 'idle') return { ready: false, reason: 'Choose a valid branch.' }
  return validation.result.ok
    ? { ready: true, reason: null }
    : { ready: false, reason: validation.result.message }
}

function selectedCommitPaths(repository: CommitOrPushRepositoryContext, includeUnstaged: boolean) {
  const paths: string[] = []
  for (const file of repository.gitStatus.changedFiles) {
    if (includeUnstaged || file.staged) paths.push(file.path)
  }
  return paths
}

function buildRunOptions(input: {
  readonly repository: CommitOrPushRepositoryContext
  readonly action: GitStackedAction
  readonly target: CommitBranchTarget
  readonly branchName: string
  readonly message: string
  readonly includeUnstaged: boolean
}): Partial<GitRunStackedActionOptions> {
  const commitOptions =
    input.action === 'push'
      ? {}
      : {
          commitMessage: input.message.trim(),
          paths: selectedCommitPaths(input.repository, input.includeUnstaged),
          includeUnstaged: input.includeUnstaged,
        }
  return {
    ...commitOptions,
    createFeatureBranch: input.target === 'new',
    featureBranchName: input.target === 'new' ? input.branchName.trim() : undefined,
    exactFeatureBranchName: input.target === 'new',
    // Main re-resolves live HEAD while holding the mutation lock. Never derive a new branch from
    // this dialog's eventually-consistent status snapshot.
    baseRef: 'HEAD',
  }
}

export function useCommitOrPushDialogController(
  props: CommitOrPushDialogProps,
): CommitOrPushDialogController {
  const { repository, operation } = props
  const [target, setTarget] = useState<CommitBranchTarget>(() => initialTarget(repository))
  const [branchName, setBranchName] = useState(() => initialBranchName(repository))
  const [message, setMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stopRequested, setStopRequested] = useState(false)
  const [preparedBranch, setPreparedBranch] = useState<PreparedBranchState | null>(null)
  const repositoryRef = repositoryBranchName(repository)
  const currentRef = currentBranchName(repository, preparedBranch)

  useEffect(() => {
    if (preparedBranch && repositoryRef !== preparedBranch.previousRef) {
      setPreparedBranch(null)
    }
  }, [preparedBranch, repositoryRef])

  const validation = useBranchValidation(repository, target, branchName)
  const branch = resolveBranchReadiness(currentRef, target, validation)
  const stats = commitCommandStats(repository.gitStatus)
  const actions = resolveCommitCommandActions({
    status: repository.gitStatus,
    vcsStatus: repository.vcsStatus,
    remoteState: repository.remoteState,
    branchTarget: target,
    branchReady: branch.ready,
    branchReason: branch.reason,
    includeUnstaged,
    message,
  })
  const primary = primaryCommitCommandAction(actions)
  function updateField<T>(setter: (value: T) => void, value: T) {
    if (!operation.running) setter(value)
  }

  async function run(action: GitStackedAction) {
    if (operation.running) return
    setError(null)
    setStopRequested(false)
    const result = await operation.run(
      action,
      buildRunOptions({ repository, action, target, branchName, message, includeUnstaged }),
    )
    if (!result) {
      setError('Git action failed before it returned a result.')
      return
    }
    if (!result.ok) {
      if (result.branch?.status === 'created' && result.branch.name) {
        setPreparedBranch({ name: result.branch.name, previousRef: repositoryRef })
        setTarget('current')
      }
      setError(result.message)
      return
    }
    props.onClose()
  }

  async function stop() {
    setStopRequested(true)
    if (!(await operation.stop())) setStopRequested(false)
  }

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (
      event.key !== 'Enter' ||
      (!event.metaKey && !event.ctrlKey) ||
      event.nativeEvent.isComposing ||
      operation.running ||
      !primary
    ) {
      return
    }
    event.preventDefault()
    void run(primary.action)
  }

  return {
    target,
    branchName,
    message,
    includeUnstaged,
    validationChecking: validation.status === 'checking',
    branchReason: branch.reason,
    error,
    stopRequested,
    stats,
    actions,
    primary,
    origin: `${target === 'new' ? 'New branch' : 'Current branch'} → ${currentRef ?? 'detached HEAD'}`,
    setTarget: (value: CommitBranchTarget) => updateField(setTarget, value),
    setBranchName: (value: string) => updateField(setBranchName, value),
    setMessage: (value: string) => updateField(setMessage, value),
    setIncludeUnstaged: (value: boolean) => updateField(setIncludeUnstaged, value),
    run,
    stop,
    onKeyDown,
  }
}
