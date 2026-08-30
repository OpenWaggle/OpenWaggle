import path from 'node:path'
import { decodeUnknownExactOrThrow, parseJsonUnknown, Schema } from '@shared/schema'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'

export interface SessionAuthoritySnapshot {
  readonly scope: LocalSessionProfileScope
  readonly projectPath: string
  readonly workingPath: string
}

const sessionAuthorityScopeSchema: Schema.Schema<LocalSessionProfileScope> = Schema.Struct({
  all: Schema.optional(Schema.Boolean),
  workspaceRoots: Schema.optional(Schema.Array(Schema.String)),
  attachmentRoots: Schema.optional(Schema.Array(Schema.String)),
  exportRoots: Schema.optional(Schema.Array(Schema.String)),
  projectPaths: Schema.optional(Schema.Array(Schema.String)),
  sessionIds: Schema.optional(Schema.Array(Schema.String)),
  hiveRootSessionIds: Schema.optional(Schema.Array(Schema.String)),
})

const sessionAuthoritySnapshotSchema: Schema.Schema<SessionAuthoritySnapshot> = Schema.Struct({
  scope: sessionAuthorityScopeSchema,
  projectPath: Schema.String,
  workingPath: Schema.String,
})

export function encodeSessionAuthoritySnapshot(snapshot: SessionAuthoritySnapshot) {
  return JSON.stringify(snapshot)
}

export function decodeSessionAuthoritySnapshot(value: string | null | undefined) {
  if (!value) return undefined
  return decodeUnknownExactOrThrow(sessionAuthoritySnapshotSchema, parseJsonUnknown(value))
}

function retargetRoot(
  roots: readonly string[] | undefined,
  previousWorkingPath: string,
  workingPath: string,
) {
  return roots?.map((root) => (root === previousWorkingPath ? workingPath : root))
}

function hasSynthesizedLocalScope(authorityOriginCallerId: string) {
  return (
    authorityOriginCallerId === 'local-user' ||
    authorityOriginCallerId === 'gui:local-user' ||
    authorityOriginCallerId.startsWith('local-user:')
  )
}

export function retargetSynthesizedSessionAuthorityScope(
  scope: LocalSessionProfileScope,
  previousWorkingPath: string,
  workingPath: string,
  authorityOriginCallerId: string,
): LocalSessionProfileScope {
  if (!hasSynthesizedLocalScope(authorityOriginCallerId)) return scope
  return {
    ...scope,
    ...(scope.workspaceRoots
      ? { workspaceRoots: retargetRoot(scope.workspaceRoots, previousWorkingPath, workingPath) }
      : {}),
    ...(scope.exportRoots
      ? { exportRoots: retargetRoot(scope.exportRoots, previousWorkingPath, workingPath) }
      : {}),
    ...(scope.attachmentRoots
      ? { attachmentRoots: retargetRoot(scope.attachmentRoots, previousWorkingPath, workingPath) }
      : {}),
  }
}

/**
 * Moves filesystem roots synthesized for a local Session agent with its Workspace.
 * Named-profile roots are explicit user policy and must never be rewritten by a handoff.
 */
export function retargetSessionAuthoritySnapshot(
  snapshot: SessionAuthoritySnapshot,
  workingPath: string,
  authorityOriginCallerId: string,
): SessionAuthoritySnapshot {
  return {
    ...snapshot,
    scope: retargetSynthesizedSessionAuthorityScope(
      snapshot.scope,
      snapshot.workingPath,
      workingPath,
      authorityOriginCallerId,
    ),
    workingPath,
  }
}

/** Validates a not-yet-materialized Workspace without granting its future path early. */
export function provisionalSessionAuthoritySnapshot(
  snapshot: SessionAuthoritySnapshot,
  plannedWorkingPath: string,
  authorityOriginCallerId: string,
): SessionAuthoritySnapshot {
  return {
    ...retargetSessionAuthoritySnapshot(snapshot, snapshot.projectPath, authorityOriginCallerId),
    workingPath: plannedWorkingPath,
  }
}

export async function assertSessionAuthoritySnapshot(snapshot: SessionAuthoritySnapshot) {
  const scopeRoots = [
    ...(snapshot.scope.projectPaths ?? []),
    ...(snapshot.scope.workspaceRoots ?? []),
    ...(snapshot.scope.exportRoots ?? []),
    ...(snapshot.scope.attachmentRoots ?? []),
  ]
  await assertCanonicalDirectoryRoots(
    [...scopeRoots, snapshot.projectPath, snapshot.workingPath],
    'Session authority root',
  )
}

export async function assertSessionAuthoritySnapshotForWorkspace(
  snapshot: SessionAuthoritySnapshot,
  workspaceState: 'pending' | 'ready',
) {
  if (workspaceState === 'ready') {
    await assertSessionAuthoritySnapshot(snapshot)
    return
  }
  if (path.resolve(snapshot.workingPath) !== snapshot.workingPath) {
    throw new Error(`Session authority working path is not absolute: ${snapshot.workingPath}`)
  }
  await assertSessionAuthoritySnapshot({ ...snapshot, workingPath: snapshot.projectPath })
}
