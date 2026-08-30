import { parseJsonUnknown } from '@shared/schema'
import { decodeLocalSessionProfileScope } from '@shared/schemas/local-session-profile'
import type { LocalSessionProfileScope } from '@shared/types/local-session-profile'
import { assertCanonicalDirectoryRoots } from '../utils/canonical-directory-roots'

export interface SessionAuthoritySnapshot {
  readonly scope: LocalSessionProfileScope
  readonly projectPath: string
  readonly workingPath: string
}

export function encodeSessionAuthoritySnapshot(snapshot: SessionAuthoritySnapshot) {
  return JSON.stringify(snapshot)
}

export function decodeSessionAuthoritySnapshot(value: string | null | undefined) {
  if (!value) return undefined
  const parsed = parseJsonUnknown(value)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Session authority snapshot is invalid.')
  }
  const record = parsed as Record<string, unknown>
  if (typeof record.projectPath !== 'string' || typeof record.workingPath !== 'string') {
    throw new Error('Session authority snapshot paths are invalid.')
  }
  return {
    scope: decodeLocalSessionProfileScope(record.scope),
    projectPath: record.projectPath,
    workingPath: record.workingPath,
  } satisfies SessionAuthoritySnapshot
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
