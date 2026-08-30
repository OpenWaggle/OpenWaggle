import { existsSync } from 'node:fs'
import type { WorktreeLaunchProgress } from '@shared/types/background-run'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { createLogger } from '../../../logger'
import { resolveSessionWorktreeBranch } from '../../../services/git/session-branch-resolution'
import { resolveWorkspaceWorktreePath } from '../../../services/git/session-worktree-path'
// ponytail: direct store import (persistence); route through a session port if the Pi adapter grows more store touchpoints.
import {
  type BoundWorkspaceResource,
  getBoundWorkspaceResource,
  setSessionWorktree,
} from '../../../store/session-details'
import { runGit } from '../../git/run-git'
import {
  applyWorkspaceHandoffSeed,
  releaseWorkspaceHandoffSeed,
} from '../../git/workspace-handoff-snapshot'
import { createGitWorktree } from '../../git/worktree'
import { requireSessionProjectPath } from './session-manager'

const logger = createLogger('session-worktree-birth')

/** Serialize birth per session so concurrent runs (classic + waggle, double-send) can't race. */
const birthInFlight = new Map<string, Promise<string>>()

interface SessionWorktreeBirthOptions {
  readonly onProgress?: (progress: WorktreeLaunchProgress) => void
  readonly signal?: AbortSignal
}

export async function ensureSessionWorktreeProjectPath(
  session: SessionDetail,
  options: SessionWorktreeBirthOptions = {},
): Promise<string> {
  const primaryPath = requireSessionProjectPath(session)
  if (session.environmentMode !== 'worktree') return primaryPath
  const workspace =
    (await getBoundWorkspaceResource(session.id)) ?? fallbackWorkspace(session, primaryPath)
  const key = workspace.id
  const existing = birthInFlight.get(key)
  if (existing) {
    try {
      return await existing
    } catch (error) {
      options.signal?.throwIfAborted()
      if (!(error instanceof Error) || error.name !== 'AbortError') throw error
      /*
       * A replacement send must not inherit the cancelled run's signal. Once the
       * shared birth settles, retry under this caller's still-live signal. The
       * deterministic path check below makes this safe even if Git completed the
       * add just before the old caller observed cancellation.
       */
      return ensureSessionWorktreeProjectPath(session, options)
    }
  }
  const pending = ensureSessionWorktreeProjectPathUnlocked(session, workspace, options).finally(
    () => {
      birthInFlight.delete(key)
    },
  )
  birthInFlight.set(key, pending)
  return await pending
}

function fallbackWorkspace(session: SessionDetail, primaryPath: string): BoundWorkspaceResource {
  const sessionId = String(session.id)
  return {
    id: sessionId,
    projectPath: primaryPath,
    kind: 'managed-worktree',
    workingPath: session.worktreePath ?? resolveWorkspaceWorktreePath(primaryPath, sessionId),
    lifecycleState: session.worktreePath ? 'ready' : 'pending',
    worktreeBranch: null,
    worktreeBaseRef: session.worktreeBaseRef ?? null,
    worktreeStartFromOrigin: session.worktreeStartFromOrigin === true,
    handoffSeedRef: null,
    handoffSeedBaseRef: null,
    handoffSeedState: 'none',
  }
}

async function isWorktreeOf(repositoryPath: string, candidatePath: string): Promise<boolean> {
  const [candidate, primary] = await Promise.all([
    runGit(candidatePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    runGit(repositoryPath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  ])
  if (candidate.code !== 0 || primary.code !== 0) return false
  return candidate.stdout.trim() !== '' && candidate.stdout.trim() === primary.stdout.trim()
}

async function applyPendingHandoffSeed(
  primaryPath: string,
  workingPath: string,
  workspace: BoundWorkspaceResource,
) {
  if (
    workspace.handoffSeedState !== 'pending' ||
    !workspace.handoffSeedRef ||
    !workspace.handoffSeedBaseRef
  ) {
    return
  }
  await applyWorkspaceHandoffSeed({
    projectPath: primaryPath,
    workingPath,
    sourceHead: workspace.handoffSeedBaseRef,
    snapshotRef: workspace.handoffSeedRef,
  })
}

async function releaseAppliedHandoffSeed(primaryPath: string, workspace: BoundWorkspaceResource) {
  if (workspace.handoffSeedState !== 'pending' || !workspace.handoffSeedRef) return
  await releaseWorkspaceHandoffSeed(primaryPath, workspace.handoffSeedRef)
}

async function recoverRecordedWorktree(input: {
  readonly session: SessionDetail
  readonly workspace: BoundWorkspaceResource
  readonly primaryPath: string
  readonly existing: string
  readonly options: SessionWorktreeBirthOptions
}) {
  if (!input.existing) return undefined
  if (existsSync(input.existing) && (await isWorktreeOf(input.primaryPath, input.existing))) {
    input.options.onProgress?.({
      stage: 'preparing-workspace',
      details: ['Recovering the session worktree'],
    })
    await applyPendingHandoffSeed(input.primaryPath, input.existing, input.workspace)
    await setSessionWorktree(
      input.session.id,
      'worktree',
      input.existing,
      input.workspace.worktreeBranch ?? undefined,
    )
    await releaseAppliedHandoffSeed(input.primaryPath, input.workspace)
    input.options.onProgress?.({
      stage: 'worktree-created',
      details: ['Recovered the existing session worktree'],
      worktreePath: input.existing,
    })
    return input.existing
  }
  logger.warn('Session worktree missing; refusing to run', {
    sessionId: String(input.session.id),
    missingWorktreePath: input.existing,
  })
  throw new Error(
    "This session's worktree no longer exists. Recreate it, or switch this session to the current checkout.",
  )
}

function requireBirthableWorkspace(workspace: BoundWorkspaceResource) {
  if (
    workspace.lifecycleState !== 'missing' &&
    workspace.lifecycleState !== 'failed' &&
    workspace.lifecycleState !== 'releasing'
  ) {
    return
  }
  throw new Error(
    `This session's Workspace is ${workspace.lifecycleState}. Repair it or hand the Session to another Workspace.`,
  )
}

async function adoptDeterministicWorktree(input: {
  readonly sessionId: string
  readonly primaryPath: string
  readonly worktreePath: string
  readonly workspace: BoundWorkspaceResource
  readonly options: SessionWorktreeBirthOptions
}) {
  if (!existsSync(input.worktreePath)) return undefined
  if (await isWorktreeOf(input.primaryPath, input.worktreePath)) {
    input.options.onProgress?.({
      stage: 'preparing-workspace',
      details: ['Recovering the session worktree'],
    })
    const branch = input.workspace.worktreeBranch ?? undefined
    await applyPendingHandoffSeed(input.primaryPath, input.worktreePath, input.workspace)
    await setSessionWorktree(SessionId(input.sessionId), 'worktree', input.worktreePath, branch)
    await releaseAppliedHandoffSeed(input.primaryPath, input.workspace)
    input.options.onProgress?.({
      stage: 'worktree-created',
      details: ['Recovered the existing session worktree'],
      worktreePath: input.worktreePath,
      ...(branch ? { branch } : {}),
    })
    return input.worktreePath
  }
  logger.warn('A non-worktree directory occupies the session worktree path', {
    sessionId: input.sessionId,
    worktreePath: input.worktreePath,
  })
  input.options.onProgress?.({
    stage: 'preparing-workspace',
    details: ['Preparing the session worktree'],
  })
  throw new Error(
    `Cannot create this session's worktree: ${input.worktreePath} already exists and is not a worktree of this repository. Remove or rename that directory, or switch this session to the current checkout.`,
  )
}

async function createSessionWorktree(input: {
  readonly sessionId: string
  readonly primaryPath: string
  readonly worktreePath: string
  readonly workspace: BoundWorkspaceResource
  readonly options: SessionWorktreeBirthOptions
}) {
  const baseRef = await resolveWorktreeBaseRef(input.workspace, input.primaryPath)
  if (!baseRef) {
    throw new Error(
      'Could not create a worktree for this session: no base branch is resolvable. Select a base branch or switch this session to Local mode.',
    )
  }
  const branch =
    input.workspace.worktreeBranch ??
    (await resolveSessionWorktreeBranch(input.primaryPath, input.sessionId))
  input.options.onProgress?.({
    stage: 'checking-out-files',
    details: [`Creating ${branch} from ${baseRef}`],
    worktreePath: input.worktreePath,
    branch,
    baseRef,
  })
  input.options.signal?.throwIfAborted()
  const payload = {
    path: input.worktreePath,
    branch,
    baseRef,
  }
  const result = input.options.signal
    ? await createGitWorktree(input.primaryPath, payload, { signal: input.options.signal })
    : await createGitWorktree(input.primaryPath, payload)
  input.options.signal?.throwIfAborted()
  if (!result.ok) {
    throw new Error(
      `Could not create a worktree for this session (${result.code}): ${result.message}. Fix the repository state or switch this session to Local mode.`,
    )
  }
  await applyPendingHandoffSeed(input.primaryPath, input.worktreePath, input.workspace)
  await setSessionWorktree(SessionId(input.sessionId), 'worktree', input.worktreePath, branch)
  await releaseAppliedHandoffSeed(input.primaryPath, input.workspace)
  input.options.onProgress?.({
    stage: 'worktree-created',
    details: [`Created ${branch} from ${baseRef}`],
    worktreePath: input.worktreePath,
    branch,
    baseRef,
  })
  return input.worktreePath
}

async function ensureSessionWorktreeProjectPathUnlocked(
  session: SessionDetail,
  workspace: BoundWorkspaceResource,
  options: SessionWorktreeBirthOptions,
): Promise<string> {
  const primaryPath = requireSessionProjectPath(session)
  const recordedPath = session.worktreePath?.trim()
  const existing =
    recordedPath || (workspace.lifecycleState === 'ready' ? workspace.workingPath.trim() : '')
  const recovered = await recoverRecordedWorktree({
    session,
    workspace,
    primaryPath,
    existing,
    options,
  })
  if (recovered) return recovered
  requireBirthableWorkspace(workspace)

  const sessionId = String(session.id)
  const worktreePath = workspace.workingPath.startsWith('pending://')
    ? resolveWorkspaceWorktreePath(primaryPath, workspace.id)
    : workspace.workingPath

  const adopted = await adoptDeterministicWorktree({
    sessionId,
    primaryPath,
    worktreePath,
    workspace,
    options,
  })
  if (adopted) return adopted
  options.onProgress?.({
    stage: 'preparing-workspace',
    details: ['Preparing the session worktree'],
  })
  return createSessionWorktree({ sessionId, primaryPath, worktreePath, workspace, options })
}

/**
 * The Worktree base ref for birth: the composer-chosen ref (optionally forked
 * from origin/<base>), else the current branch, else null (blocks the run).
 */
async function resolveWorktreeBaseRef(
  workspace: BoundWorkspaceResource,
  projectPath: string,
): Promise<string | null> {
  const chosen = workspace.worktreeBaseRef?.trim()
  const base = chosen && chosen.length > 0 ? chosen : await resolveCurrentBranch(projectPath)
  if (!base) return null
  if (workspace.worktreeStartFromOrigin && !base.includes('/')) return `origin/${base}`
  return base
}

async function resolveCurrentBranch(projectPath: string): Promise<string | null> {
  const branch = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch.code === 0 && branch.stdout.trim()) return branch.stdout.trim()
  return null
}
