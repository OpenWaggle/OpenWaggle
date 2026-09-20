import { createHash } from 'node:crypto'
import { SessionWorkspaceHandoffPreparationError } from '../../ports/session-workspace-handoff-service'
import { runGit } from './run-git'
import {
  captureWorkspaceHandoffSeed,
  releaseWorkspaceHandoffSeed,
} from './workspace-handoff-snapshot'

const WORKSPACE_ID_DIGEST_LENGTH = 32

export function preparedWorkspaceId(input: {
  readonly callerId: string
  readonly sessionId: string
  readonly idempotencyKey: string
}) {
  const digest = createHash('sha256')
    .update(`${input.callerId}\0${input.sessionId}\0${input.idempotencyKey}`)
    .digest('hex')
    .slice(0, WORKSPACE_ID_DIGEST_LENGTH)
  return `workspace-${digest}`
}

export function handoffPreparationError(
  code: SessionWorkspaceHandoffPreparationError['code'],
  cause: unknown,
) {
  return new SessionWorkspaceHandoffPreparationError({ code, cause })
}

async function assertRequestedBaseRef(
  projectPath: string,
  requestedBaseRef: string | undefined,
  sourceHead: string,
) {
  if (!requestedBaseRef) return
  const result = await runGit(projectPath, [
    'rev-parse',
    '--verify',
    `${requestedBaseRef}^{commit}`,
  ])
  if (result.code !== 0 || result.stdout.trim() !== sourceHead) {
    throw new Error(
      'A Workspace handoff must start from the source Workspace HEAD; the requested base ref resolves elsewhere.',
    )
  }
}

export async function captureNewWorkspaceSeed(input: {
  readonly projectPath: string
  readonly workingPath: string
  readonly workspaceId: string
  readonly requestedBaseRef?: string
}) {
  let seed: Awaited<ReturnType<typeof captureWorkspaceHandoffSeed>>
  try {
    seed = await captureWorkspaceHandoffSeed(input)
  } catch (cause) {
    throw handoffPreparationError('workspace_snapshot_failed', cause)
  }
  try {
    await assertRequestedBaseRef(input.projectPath, input.requestedBaseRef, seed.sourceHead)
    return seed
  } catch (cause) {
    await releaseWorkspaceHandoffSeed(input.projectPath, seed.snapshotRef)
    throw handoffPreparationError('workspace_base_ref_mismatch', cause)
  }
}

export async function captureExistingWorkspaceSeeds(input: {
  readonly projectPath: string
  readonly sourceWorkingPath: string
  readonly targetWorkingPath: string
  readonly transferId: string
}) {
  let source: Awaited<ReturnType<typeof captureWorkspaceHandoffSeed>>
  let target: Awaited<ReturnType<typeof captureWorkspaceHandoffSeed>> | undefined
  try {
    source = await captureWorkspaceHandoffSeed({
      projectPath: input.projectPath,
      workingPath: input.sourceWorkingPath,
      workspaceId: `${input.transferId}-source`,
    })
  } catch (cause) {
    throw handoffPreparationError('workspace_snapshot_failed', cause)
  }
  try {
    target = await captureWorkspaceHandoffSeed({
      projectPath: input.projectPath,
      workingPath: input.targetWorkingPath,
      workspaceId: `${input.transferId}-target`,
    })
    if (target.sourceHead !== source.sourceHead) {
      throw new Error('Target Workspace history changed before handoff admission.')
    }
    return { source, target }
  } catch (cause) {
    await Promise.all([
      releaseWorkspaceHandoffSeed(input.projectPath, source.snapshotRef),
      ...(target ? [releaseWorkspaceHandoffSeed(input.projectPath, target.snapshotRef)] : []),
    ])
    throw handoffPreparationError('workspace_snapshot_failed', cause)
  }
}
