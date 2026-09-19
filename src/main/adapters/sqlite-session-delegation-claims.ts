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
  type NormalizedClaim,
  type ResolvedClaim,
  type ResolvedStoredClaim,
  recordDelegationClaimConflicts,
  type StoredClaimRow,
} from './session-delegation-claim-conflicts'
import { createSessionDelegationClaimPathResolver } from './session-delegation-claim-paths'
import {
  type DelegationContractRow,
  type ExecuteDelegationInput,
  rejectedDelegationOutcome,
} from './sqlite-session-delegation-support'

interface DelegationWorkspaceRow {
  readonly project_path: string
  readonly workspace_id: string
  readonly working_path: string
}

type ClaimPathResolver = ReturnType<typeof createSessionDelegationClaimPathResolver>

const GLOB_CHARACTERS = /[*?[\]{}]/u

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

async function resolveClaims(
  claims: readonly NormalizedClaim[],
  workingPath: string,
  resolvePath: ClaimPathResolver,
) {
  const keys = await Promise.all(
    claims.map((claim) =>
      claim.targetKind === 'named-resource'
        ? claim.targetValue
        : resolvePath(workingPath, claim.targetValue),
    ),
  )
  const resolved: ResolvedClaim[] = []
  const seen = new Set<string>()
  for (const [index, claim] of claims.entries()) {
    const targetKey = keys[index]
    if (targetKey === undefined) return undefined
    const key = canonicalJson({ ...claim, targetValue: targetKey })
    if (seen.has(key)) continue
    seen.add(key)
    resolved.push({ claim, targetKey })
  }
  return resolved
}

function resolveStoredClaims(rows: readonly StoredClaimRow[], resolvePath: ClaimPathResolver) {
  return Promise.all(
    rows.map(async (row): Promise<ResolvedStoredClaim> => {
      const targetKey =
        row.target_kind === 'named-resource'
          ? row.target_value
          : await resolvePath(row.working_path, row.target_value)
      if (targetKey === undefined) {
        throw new Error(
          `A stored Delegation claim escapes its bound workspace: ${row.delegation_id}`,
        )
      }
      return { row, targetKey }
    }),
  )
}

function loadDelegationWorkspace(sql: SqlClient.SqlClient, contract: DelegationContractRow) {
  return sql<DelegationWorkspaceRow>`
    SELECT resources.project_path, resources.id AS workspace_id, resources.working_path
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
      resources.id AS workspace_id, resources.working_path,
      claims.target_kind, claims.target_value,
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
    const normalizedClaims = normalizeClaims(command.claims)
    if (!normalizedClaims) return rejectedDelegationOutcome(input, 'claim_target_invalid')
    const workspace = yield* loadDelegationWorkspace(sql, contract)
    if (!workspace) return rejectedDelegationOutcome(input, 'delegation_workspace_missing')
    const resolvePath = createSessionDelegationClaimPathResolver()
    const claims = yield* Effect.promise(() =>
      resolveClaims(normalizedClaims, workspace.working_path, resolvePath),
    )
    if (!claims) return rejectedDelegationOutcome(input, 'claim_target_invalid')
    const revisionRows = yield* sql<{ revision: number }>`
      SELECT COALESCE(MAX(revision), 0) + 1 AS revision
      FROM delegation_claim_revisions WHERE delegation_id = ${contract.id}
    `
    const revision = revisionRows[0]?.revision ?? 1
    const otherClaims = yield* loadOtherWriteClaims(sql, contract, workspace.project_path)
    const resolvedOtherClaims = yield* Effect.promise(() =>
      resolveStoredClaims(otherClaims, resolvePath),
    )
    yield* sql`
      INSERT INTO delegation_claim_revisions (
        delegation_id, revision, actor_session_id, authored_by, reason, created_at
      ) VALUES (
        ${contract.id}, ${revision}, ${command.sessionId}, ${input.callerId},
        ${command.reason.trim()}, ${input.now}
      )
    `
    for (const [ordinal, { claim }] of claims.entries()) {
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
    const conflictIds = yield* recordDelegationClaimConflicts(sql, {
      delegationId: contract.id,
      workspaceId: workspace.workspace_id,
      revision,
      claims,
      otherClaims: resolvedOtherClaims,
      now: input.now,
    })
    return claimsOutcome(input, revision, conflictIds)
  })
}
