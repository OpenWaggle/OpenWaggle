import { createHash } from 'node:crypto'
import path from 'node:path'
import type * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import type {
  DelegationClaimTarget,
  DelegationScopeClaimInput,
} from '@shared/types/session-collaboration'
import type { SessionControlMutationOutcome } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
} from './sqlite-session-delegation-support'

interface DelegationWorkspaceRow {
  readonly project_path: string
  readonly workspace_id: string
}

interface StoredClaimRow {
  readonly delegation_id: string
  readonly revision: number
  readonly ordinal: number
  readonly workspace_id: string
  readonly target_kind: DelegationClaimTarget['type']
  readonly target_value: string
  readonly target_namespace: string | null
  readonly target_scope: 'project' | 'repository' | null
}

interface NormalizedClaim {
  readonly access: 'read' | 'write'
  readonly targetKind: DelegationClaimTarget['type']
  readonly targetValue: string
  readonly targetNamespace: string | null
  readonly targetScope: 'project' | 'repository' | null
}

const GLOB_CHARACTERS = /[*?[\]{}]/u
const CONFLICT_ID_DIGEST_LENGTH = 24

function normalizeWorkspacePath(target: Extract<DelegationClaimTarget, { path: string }>) {
  const value = target.path.trim()
  if (
    value.length === 0 ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    GLOB_CHARACTERS.test(value) ||
    value.split('/').includes('..')
  ) {
    return undefined
  }
  const normalized = path.posix.normalize(value).replace(/^\.\//u, '')
  if (normalized === '..' || normalized.startsWith('../')) return undefined
  if (target.type === 'workspace-file' && normalized === '.') return undefined
  return normalized
}

function normalizeClaim(claim: DelegationScopeClaimInput): NormalizedClaim | undefined {
  if (claim.target.type === 'named-resource') {
    const namespace = claim.target.namespace.trim()
    const name = claim.target.name.trim()
    if (namespace.length === 0 || name.length === 0) return undefined
    return {
      access: claim.access,
      targetKind: claim.target.type,
      targetValue: name,
      targetNamespace: namespace,
      targetScope: claim.target.scope,
    }
  }
  const normalizedPath = normalizeWorkspacePath(claim.target)
  if (!normalizedPath) return undefined
  return {
    access: claim.access,
    targetKind: claim.target.type,
    targetValue: normalizedPath,
    targetNamespace: null,
    targetScope: null,
  }
}

function normalizeClaims(claims: readonly DelegationScopeClaimInput[]) {
  const normalized: NormalizedClaim[] = []
  const seen = new Set<string>()
  for (const claim of claims) {
    const value = normalizeClaim(claim)
    if (!value) return undefined
    const key = canonicalJson(value)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(value)
  }
  return normalized
}

function pathWithinTree(candidate: string, tree: string) {
  return tree === '.' || candidate === tree || candidate.startsWith(`${tree}/`)
}

function targetsOverlap(left: NormalizedClaim, right: StoredClaimRow) {
  if (left.targetKind === 'named-resource' || right.target_kind === 'named-resource') {
    return (
      left.targetKind === 'named-resource' &&
      right.target_kind === 'named-resource' &&
      left.targetScope === right.target_scope &&
      left.targetNamespace === right.target_namespace &&
      left.targetValue === right.target_value
    )
  }
  if (left.targetKind === 'workspace-file' && right.target_kind === 'workspace-file') {
    return left.targetValue === right.target_value
  }
  if (left.targetKind === 'workspace-file') {
    return pathWithinTree(left.targetValue, right.target_value)
  }
  if (right.target_kind === 'workspace-file') {
    return pathWithinTree(right.target_value, left.targetValue)
  }
  return (
    pathWithinTree(left.targetValue, right.target_value) ||
    pathWithinTree(right.target_value, left.targetValue)
  )
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

function loadDelegationWorkspace(sql: SqlClient.SqlClient, contract: DelegationContractRow) {
  return sql<DelegationWorkspaceRow>`
    SELECT resources.project_path, resources.id AS workspace_id
    FROM session_workspace_bindings AS bindings
    JOIN workspace_resources AS resources ON resources.id = bindings.workspace_id
    WHERE bindings.session_id = ${contract.child_session_id}
    LIMIT 1
  `.pipe(Effect.map((rows) => rows[0]))
}

function loadOtherWriteClaims(
  sql: SqlClient.SqlClient,
  contract: DelegationContractRow,
  projectPath: string,
) {
  return sql<StoredClaimRow>`
    SELECT claims.delegation_id, claims.revision, claims.ordinal,
      resources.id AS workspace_id, claims.target_kind, claims.target_value,
      claims.target_namespace, claims.target_scope
    FROM delegation_scope_claims AS claims
    JOIN delegation_contracts AS contracts ON contracts.id = claims.delegation_id
    JOIN session_workspace_bindings AS bindings
      ON bindings.session_id = contracts.child_session_id
    JOIN workspace_resources AS resources ON resources.id = bindings.workspace_id
    WHERE claims.access = ${'write'}
      AND contracts.id <> ${contract.id}
      AND contracts.state NOT IN (${'accepted'}, ${'cancelled'})
      AND resources.project_path = ${projectPath}
      AND claims.revision = (
        SELECT MAX(revisions.revision)
        FROM delegation_claim_revisions AS revisions
        WHERE revisions.delegation_id = claims.delegation_id
      )
    ORDER BY claims.delegation_id, claims.ordinal
  `
}

function claimsOutcome(
  input: ExecuteDelegationInput,
  claimRevision: number,
  conflictIds: readonly string[],
): Extract<SessionControlMutationOutcome, { readonly effect: 'delegation-claims-updated' }> {
  return {
    operation: 'delegation-claim',
    effect: 'delegation-claims-updated',
    sessionId: input.request.command.sessionId,
    delegationId: input.request.command.delegationId,
    claimRevision,
    conflictIds,
  }
}

export function updateDelegationClaims(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-claim') return undefined
    if (command.sessionId !== contract.child_session_id) {
      return rejectedDelegationOutcome(input, 'worker_required')
    }
    if (['accepted', 'cancelled'].includes(contract.state)) {
      return rejectedDelegationOutcome(input, 'delegation_not_contributable')
    }
    if (command.reason.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'claim_reason_required')
    }
    const claims = normalizeClaims(command.claims)
    if (!claims) return rejectedDelegationOutcome(input, 'claim_target_invalid')
    const workspace = yield* loadDelegationWorkspace(sql, contract)
    if (!workspace) return rejectedDelegationOutcome(input, 'delegation_workspace_missing')
    const revisionRows = yield* sql<{ revision: number }>`
      SELECT COALESCE(MAX(revision), 0) + 1 AS revision
      FROM delegation_claim_revisions WHERE delegation_id = ${contract.id}
    `
    const revision = revisionRows[0]?.revision ?? 1
    const otherClaims = yield* loadOtherWriteClaims(sql, contract, workspace.project_path)
    yield* sql`
      INSERT INTO delegation_claim_revisions (
        delegation_id, revision, actor_session_id, authored_by, reason, created_at
      ) VALUES (
        ${contract.id}, ${revision}, ${command.sessionId}, ${input.callerId},
        ${command.reason.trim()}, ${input.now}
      )
    `
    for (const [ordinal, claim] of claims.entries()) {
      yield* sql`
        INSERT INTO delegation_scope_claims (
          delegation_id, revision, ordinal, access, target_kind, target_value,
          target_namespace, target_scope, created_at
        ) VALUES (
          ${contract.id}, ${revision}, ${ordinal}, ${claim.access}, ${claim.targetKind},
          ${claim.targetValue}, ${claim.targetNamespace}, ${claim.targetScope}, ${input.now}
        )
      `
    }
    yield* sql`
      UPDATE delegation_conflicts SET resolved_at = ${input.now}
      WHERE resolved_at IS NULL
        AND (left_delegation_id = ${contract.id} OR right_delegation_id = ${contract.id})
    `
    const conflictIds: string[] = []
    for (const [ordinal, claim] of claims.entries()) {
      if (claim.access !== 'write') continue
      for (const other of otherClaims) {
        if (!targetsOverlap(claim, other)) continue
        const id = conflictId({
          currentDelegationId: contract.id,
          currentRevision: revision,
          currentOrdinal: ordinal,
          other,
        })
        const [leftDelegationId, rightDelegationId] = [contract.id, other.delegation_id].sort()
        const kind =
          workspace.workspace_id === other.workspace_id ? 'live-overlap' : 'merge-overlap'
        const evidence = {
          current: { delegationId: contract.id, revision, ordinal, claim },
          other: {
            delegationId: other.delegation_id,
            revision: other.revision,
            ordinal: other.ordinal,
            targetKind: other.target_kind,
            targetValue: other.target_value,
            targetNamespace: other.target_namespace,
            targetScope: other.target_scope,
          },
          workspaces: [workspace.workspace_id, other.workspace_id],
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
    return claimsOutcome(input, revision, conflictIds)
  })
}
