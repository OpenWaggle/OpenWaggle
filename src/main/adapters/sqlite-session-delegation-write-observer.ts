import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'

interface DelegationRow {
  readonly delegation_id: string
}

interface LatestClaimRevisionRow {
  readonly revision: number
}

interface WriteClaimRow {
  readonly target_kind: 'workspace-file' | 'workspace-tree' | 'named-resource'
  readonly target_value: string
}

export interface DelegationUndeclaredWriteObservation {
  readonly id: string
  readonly delegationId: string
  readonly workerSessionId: string
  readonly runId: string
  readonly path: string
  readonly claimRevision?: number
  readonly provenance: 'isolated-turn-checkpoint'
  readonly createdAt: number
}

function normalizedObservedPath(value: string) {
  const normalized = path.posix.normalize(value.trim()).replace(/^\.\//u, '')
  if (
    normalized.length === 0 ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized) ||
    normalized.includes('\\') ||
    normalized.includes('\0')
  ) {
    return undefined
  }
  return normalized
}

function pathWithinTree(candidate: string, tree: string) {
  return tree === '.' || candidate === tree || candidate.startsWith(`${tree}/`)
}

export function writeClaimCoversPath(claim: WriteClaimRow, candidate: string) {
  if (claim.target_kind === 'named-resource') return false
  return claim.target_kind === 'workspace-file'
    ? claim.target_value === candidate
    : pathWithinTree(candidate, claim.target_value)
}

/**
 * Persist advisory evidence for writes that an isolated Worker turn changed
 * outside every write claim in the latest claim revision. The caller must only
 * provide paths from a checkpoint whose worktree is exclusive to this Worker.
 */
export function observeDelegationTurnWrites(
  sql: SqlClient.SqlClient,
  input: {
    readonly workerSessionId: string
    readonly runId: string
    readonly paths: readonly string[]
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    const delegations = yield* sql<DelegationRow>`
      SELECT id AS delegation_id FROM delegation_contracts
      WHERE child_session_id = ${input.workerSessionId}
      LIMIT 1
    `
    const delegation = delegations[0]
    if (!delegation) return []

    const revisions = yield* sql<LatestClaimRevisionRow>`
      SELECT MAX(revision) AS revision FROM delegation_claim_revisions
      WHERE delegation_id = ${delegation.delegation_id}
    `
    const claimRevision = revisions[0]?.revision
    const claims = claimRevision
      ? yield* sql<WriteClaimRow>`
          SELECT target_kind, target_value FROM delegation_scope_claims
          WHERE delegation_id = ${delegation.delegation_id}
            AND revision = ${claimRevision}
            AND access = ${'write'}
          ORDER BY ordinal
        `
      : []
    const paths = [
      ...new Set(
        input.paths
          .map(normalizedObservedPath)
          .filter((value): value is string => value !== undefined),
      ),
    ]
    const observations: DelegationUndeclaredWriteObservation[] = []
    for (const observedPath of paths) {
      if (claims.some((claim) => writeClaimCoversPath(claim, observedPath))) continue
      const observation: DelegationUndeclaredWriteObservation = {
        id: randomUUID(),
        delegationId: delegation.delegation_id,
        workerSessionId: input.workerSessionId,
        runId: input.runId,
        path: observedPath,
        ...(claimRevision ? { claimRevision } : {}),
        provenance: 'isolated-turn-checkpoint',
        createdAt: input.now,
      }
      const inserted = yield* sql<{ readonly id: string }>`
        INSERT INTO delegation_undeclared_writes (
          id, delegation_id, worker_session_id, run_id, path,
          claim_revision, provenance, created_at
        ) VALUES (
          ${observation.id}, ${observation.delegationId}, ${observation.workerSessionId},
          ${observation.runId}, ${observation.path}, ${claimRevision ?? null},
          ${observation.provenance}, ${observation.createdAt}
        )
        ON CONFLICT(delegation_id, run_id, path) DO NOTHING
        RETURNING id
      `
      if (inserted.length > 0) observations.push(observation)
    }
    return observations
  })
}
