import { createHash } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import type { DelegationClaimTarget } from '@shared/types/session-collaboration'
import * as Effect from 'effect/Effect'

export interface StoredClaimRow {
  readonly delegation_id: string
  readonly revision: number
  readonly ordinal: number
  readonly workspace_id: string
  readonly working_path: string
  readonly target_kind: DelegationClaimTarget['type']
  readonly target_value: string
  readonly target_namespace: string | null
  readonly target_scope: 'project' | 'repository' | null
}

export interface NormalizedClaim {
  readonly access: 'read' | 'write'
  readonly targetKind: DelegationClaimTarget['type']
  readonly targetValue: string
  readonly targetNamespace: string | null
  readonly targetScope: 'project' | 'repository' | null
}

export interface ResolvedClaim {
  readonly claim: NormalizedClaim
  readonly targetKey: string
  readonly caseSensitive: boolean
}

export interface ResolvedStoredClaim {
  readonly row: StoredClaimRow
  readonly targetKey: string
  readonly caseSensitive: boolean
}

const CONFLICT_ID_DIGEST_LENGTH = 24

function pathWithinTree(candidate: string, tree: string) {
  return tree === '.' || candidate === tree || candidate.startsWith(`${tree}/`)
}

export function targetsOverlap(left: ResolvedClaim, right: ResolvedStoredClaim) {
  const claim = left.claim
  const row = right.row
  if (claim.targetKind === 'named-resource' || row.target_kind === 'named-resource') {
    return (
      claim.targetKind === 'named-resource' &&
      row.target_kind === 'named-resource' &&
      claim.targetScope === row.target_scope &&
      claim.targetNamespace === row.target_namespace &&
      left.targetKey === right.targetKey
    )
  }
  const sharedCaseSensitive = left.caseSensitive && right.caseSensitive
  const leftKey = sharedCaseSensitive ? left.targetKey : left.targetKey.toLowerCase()
  const rightKey = sharedCaseSensitive ? right.targetKey : right.targetKey.toLowerCase()
  if (claim.targetKind === 'workspace-file' && row.target_kind === 'workspace-file') {
    return leftKey === rightKey
  }
  if (claim.targetKind === 'workspace-file') {
    return pathWithinTree(leftKey, rightKey)
  }
  if (row.target_kind === 'workspace-file') {
    return pathWithinTree(rightKey, leftKey)
  }
  return pathWithinTree(leftKey, rightKey) || pathWithinTree(rightKey, leftKey)
}

function conflictId(input: {
  readonly currentDelegationId: string
  readonly currentRevision: number
  readonly currentOrdinal: number
  readonly other: StoredClaimRow
}) {
  return `conflict-${createHash('sha256')
    .update(canonicalJson(input))
    .digest('hex')
    .slice(0, CONFLICT_ID_DIGEST_LENGTH)}`
}

export function recordDelegationClaimConflicts(
  sql: SqlClient.SqlClient,
  input: {
    readonly delegationId: string
    readonly workspaceId: string
    readonly revision: number
    readonly claims: readonly ResolvedClaim[]
    readonly otherClaims: readonly ResolvedStoredClaim[]
    readonly now: number
  },
) {
  return Effect.gen(function* () {
    const conflictIds: string[] = []
    for (const [ordinal, resolvedClaim] of input.claims.entries()) {
      const claim = resolvedClaim.claim
      if (claim.access !== 'write') continue
      for (const resolvedOther of input.otherClaims) {
        if (!targetsOverlap(resolvedClaim, resolvedOther)) continue
        const other = resolvedOther.row
        const id = conflictId({
          currentDelegationId: input.delegationId,
          currentRevision: input.revision,
          currentOrdinal: ordinal,
          other,
        })
        const [leftDelegationId, rightDelegationId] = [
          input.delegationId,
          other.delegation_id,
        ].sort()
        const kind = input.workspaceId === other.workspace_id ? 'live-overlap' : 'merge-overlap'
        const evidence = {
          current: { delegationId: input.delegationId, revision: input.revision, ordinal, claim },
          other: {
            delegationId: other.delegation_id,
            revision: other.revision,
            ordinal: other.ordinal,
            targetKind: other.target_kind,
            targetValue: other.target_value,
            targetNamespace: other.target_namespace,
            targetScope: other.target_scope,
          },
          workspaces: [input.workspaceId, other.workspace_id],
        }
        yield* sql`
          INSERT INTO delegation_conflicts (
            id, left_delegation_id, right_delegation_id, kind, evidence_json, created_at
          ) VALUES (
            ${id}, ${leftDelegationId}, ${rightDelegationId}, ${kind},
            ${JSON.stringify(evidence)}, ${input.now}
          )
        `
        conflictIds.push(id)
      }
    }
    return conflictIds
  })
}
