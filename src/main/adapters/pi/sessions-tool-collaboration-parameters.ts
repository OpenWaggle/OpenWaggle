import { Type } from 'typebox'
import { delegationVerifyParameter } from './sessions-tool-delegation-extra-parameters'

const delegationSpecification = Type.Object({
  objective: Type.String(),
  deliverables: Type.Array(Type.String()),
  acceptanceCriteria: Type.Array(Type.String()),
  dependencies: Type.Array(
    Type.Object({
      delegationId: Type.String(),
      requiredState: Type.Union([Type.Literal('ready_for_review'), Type.Literal('accepted')]),
    }),
  ),
  handoffContext: Type.Optional(Type.String()),
  resourceReferences: Type.Array(Type.String()),
})

export const sessionsToolCollaborationParameters = [
  Type.Object({
    action: Type.Literal('report'),
    text: Type.String({ minLength: 1 }),
    target: Type.Union([
      Type.Object({ type: Type.Literal('upstream') }),
      Type.Object({ type: Type.Literal('queen') }),
      Type.Object({ type: Type.Literal('session'), sessionId: Type.String() }),
      Type.Object({ type: Type.Literal('sessions'), sessionIds: Type.Array(Type.String()) }),
      Type.Object({ type: Type.Literal('worker_reference'), reference: Type.String() }),
    ]),
    requestReply: Type.Optional(Type.Boolean()),
    replyToReportId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('delegation_submit'),
    delegationId: Type.String(),
    summary: Type.String({ minLength: 1 }),
    evidence: Type.Optional(
      Type.Array(
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
      ),
    ),
  }),
  Type.Object({
    action: Type.Literal('delegation_state'),
    delegationId: Type.String(),
    state: Type.Union([
      Type.Literal('working'),
      Type.Literal('waiting'),
      Type.Literal('needs_attention'),
    ]),
    reason: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    action: Type.Literal('delegation_claim'),
    delegationId: Type.String(),
    claims: Type.Array(
      Type.Object({
        access: Type.Union([Type.Literal('read'), Type.Literal('write')]),
        target: Type.Union([
          Type.Object({ type: Type.Literal('workspace-file'), path: Type.String() }),
          Type.Object({ type: Type.Literal('workspace-tree'), path: Type.String() }),
          Type.Object({
            type: Type.Literal('named-resource'),
            scope: Type.Union([Type.Literal('project'), Type.Literal('repository')]),
            namespace: Type.String(),
            name: Type.String(),
          }),
        ]),
      }),
    ),
    reason: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    action: Type.Literal('delegation_conflict_acknowledge'),
    delegationId: Type.String(),
    conflictId: Type.String(),
    reason: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    action: Type.Literal('delegation_dependency'),
    delegationId: Type.String(),
    dependencyAction: Type.Union([Type.Literal('add'), Type.Literal('remove')]),
    dependencyDelegationId: Type.String(),
    requiredState: Type.Union([Type.Literal('ready_for_review'), Type.Literal('accepted')]),
    reason: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    action: Type.Literal('delegation_propose_amendment'),
    delegationId: Type.String(),
    baseSpecificationRevision: Type.Integer({ minimum: 1 }),
    specification: delegationSpecification,
    reason: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    action: Type.Literal('delegation_amend'),
    delegationId: Type.String(),
    expectedSpecificationRevision: Type.Integer({ minimum: 1 }),
    specification: delegationSpecification,
    reason: Type.String({ minLength: 1 }),
    proposalId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('delegation_request_revision'),
    delegationId: Type.String(),
    submissionRevision: Type.Integer({ minimum: 1 }),
    feedback: Type.String({ minLength: 1 }),
    revisedSpecification: Type.Optional(
      Type.Object({
        objective: Type.String(),
        deliverables: Type.Array(Type.String()),
        acceptanceCriteria: Type.Array(Type.String()),
        handoffContext: Type.Optional(Type.String()),
        resourceReferences: Type.Array(Type.String()),
      }),
    ),
  }),
  Type.Object({
    action: Type.Literal('delegation_accept'),
    delegationId: Type.String(),
    submissionRevision: Type.Integer({ minimum: 1 }),
    note: Type.Optional(Type.String()),
  }),
  delegationVerifyParameter,
  Type.Object({
    action: Type.Union([Type.Literal('delegation_reopen'), Type.Literal('delegation_cancel')]),
    delegationId: Type.String(),
    reason: Type.String({ minLength: 1 }),
  }),
] as const
