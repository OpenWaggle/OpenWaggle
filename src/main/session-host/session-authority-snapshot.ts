import path from 'node:path'
import {
  decodeUnknownExactOrThrow,
  parseJsonUnknown,
  type SchemaType,
  Schema,
} from '@shared/schema'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'

/**
 * A persisted authority scope. It is read without the profile scope's entry bounds, so a snapshot
 * stored before a bound changed stays readable; its type is still `LocalSessionProfileScope`.
 */
const sessionAuthorityScopeSchema = Schema.Struct({
  all: Schema.optionalWith(Schema.Boolean, { exact: true }),
  workspaceRoots: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  attachmentRoots: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  exportRoots: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  projectPaths: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  sessionIds: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
  hiveRootSessionIds: Schema.optionalWith(Schema.Array(Schema.String), { exact: true }),
})

const sessionAuthoritySnapshotSchema = Schema.Struct({
  scope: sessionAuthorityScopeSchema,
  projectPath: Schema.String,
  workingPath: Schema.String,
})
export type SessionAuthoritySnapshot = SchemaType<typeof sessionAuthoritySnapshotSchema>

export function encodeSessionAuthoritySnapshot(snapshot: SessionAuthoritySnapshot) {
  return JSON.stringify(snapshot)
}

export function decodeSessionAuthoritySnapshot(value: string | null | undefined) {
  if (!value) return undefined
  return decodeUnknownExactOrThrow(sessionAuthoritySnapshotSchema, parseJsonUnknown(value))
}

function retargetRoot(roots: readonly string[], previousWorkingPath: string, workingPath: string) {
  return roots.map((root) => (root === previousWorkingPath ? workingPath : root))
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

/**
 * The scope stored for a new Worker. A catalog-wide parent (ADR 0042) must not hand that reach to
 * its Workers' snapshots: a Worker never reaches every project, and a future feature that promotes
 * or detaches a Worker would otherwise inherit it. The Worker gets its project instead, which is
 * what a Worker snapshot held before root agents reached every project.
 */
export function workerAuthorityScope(
  scope: LocalSessionProfileScope,
  projectPath: string,
): LocalSessionProfileScope {
  if (scope.all !== true) return scope
  const { all: _all, ...rest } = scope
  return { ...rest, projectPaths: [projectPath] }
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
