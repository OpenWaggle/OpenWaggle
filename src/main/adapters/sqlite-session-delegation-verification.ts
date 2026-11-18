import { randomUUID } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type {
  DelegationContractRow,
  ExecuteDelegationInput,
} from './sqlite-session-delegation-support'
import { rejectedDelegationOutcome } from './sqlite-session-delegation-support'

interface SubmissionRow {
  readonly revision: number
  readonly specification_revision: number
}

export function recordDelegationVerification(
  sql: SqlClient.SqlClient,
  input: ExecuteDelegationInput,
  contract: DelegationContractRow,
) {
  return Effect.gen(function* () {
    const command = input.request.command
    if (command.operation !== 'delegation-verify') return undefined
    if (command.sessionId !== contract.parent_session_id) {
      return rejectedDelegationOutcome(input, 'parent_required')
    }
    if (command.summary.trim().length === 0) {
      return rejectedDelegationOutcome(input, 'verification_summary_required')
    }
    const submissions = yield* sql<SubmissionRow>`
      SELECT revision, specification_revision FROM delegation_submissions
      WHERE delegation_id = ${contract.id} AND revision = ${command.submissionRevision}
      LIMIT 1
    `
    const submission = submissions[0]
    if (!submission) return rejectedDelegationOutcome(input, 'submission_not_found')
    const verificationId = `verification-${randomUUID()}`
    yield* sql`
      INSERT INTO delegation_verifications (
        id, delegation_id, submission_revision, specification_revision,
        verifier_session_id, verified_by, outcome, summary, created_at
      ) VALUES (
        ${verificationId}, ${contract.id}, ${submission.revision},
        ${submission.specification_revision}, ${command.sessionId}, ${input.callerId},
        ${command.outcome}, ${command.summary}, ${input.now}
      )
    `
    for (const [ordinal, evidence] of command.evidence.entries()) {
      yield* sql`
        INSERT INTO delegation_verification_evidence (
          verification_id, ordinal, kind, summary, reference, provenance_json, created_at
        ) VALUES (
          ${verificationId}, ${ordinal}, ${evidence.kind}, ${evidence.summary},
          ${evidence.reference ?? null},
          ${evidence.provenance ? JSON.stringify(evidence.provenance) : null}, ${input.now}
        )
      `
    }
    return {
      operation: command.operation,
      effect: 'delegation-verification-recorded',
      sessionId: command.sessionId,
      delegationId: contract.id,
      verificationId,
      submissionRevision: submission.revision,
      verificationOutcome: command.outcome,
      createdAt: input.now,
    } as const
  })
}
