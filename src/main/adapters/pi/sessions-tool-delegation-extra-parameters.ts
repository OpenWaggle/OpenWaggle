import { SESSION_QUERY_DISCOVERY_LIMIT } from '@shared/types/session-query'
import { Type } from 'typebox'

const evidence = Type.Array(
  Type.Object({
    kind: Type.Union([
      Type.Literal('observed-command'),
      Type.Literal('workspace-diff'),
      Type.Literal('artifact'),
      Type.Literal('source-reference'),
      Type.Literal('asserted-note'),
    ]),
    summary: Type.String(),
    reference: Type.Optional(Type.String()),
    provenance: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
)

export const delegationVerifyParameter = Type.Object({
  action: Type.Literal('delegation_verify'),
  delegationId: Type.String(),
  submissionRevision: Type.Integer({ minimum: 1 }),
  outcome: Type.Union([
    Type.Literal('passed'),
    Type.Literal('failed'),
    Type.Literal('inconclusive'),
  ]),
  summary: Type.String({ minLength: 1 }),
  evidence: Type.Optional(evidence),
})

export const delegationsConflictsParameter = Type.Object({
  action: Type.Literal('delegations_conflicts'),
  catalogScope: Type.Optional(
    Type.Union([Type.Literal('current'), Type.Literal('project'), Type.Literal('all')]),
  ),
  projectPath: Type.Optional(Type.String()),
  parentSessionId: Type.Optional(Type.String()),
  workerSessionId: Type.Optional(Type.String()),
  delegationId: Type.Optional(Type.String()),
  kinds: Type.Optional(
    Type.Array(Type.Union([Type.Literal('live-overlap'), Type.Literal('merge-overlap')])),
  ),
  statuses: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('unacknowledged'),
        Type.Literal('acknowledged'),
        Type.Literal('resolved'),
      ]),
    ),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_DISCOVERY_LIMIT })),
  cursor: Type.Optional(Type.String()),
})
