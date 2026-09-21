import {
  SESSION_QUERY_DISCOVERY_LIMIT,
  SESSION_QUERY_TRANSCRIPT_LIMIT,
} from '@shared/types/session-query'
import { Type } from 'typebox'

const exportSnapshotManifest = Type.Object({
  schemaVersion: Type.Literal(1),
  sessionId: Type.String(),
  title: Type.String(),
  branchScope: Type.Union([Type.Literal('active-branch'), Type.Literal('tree')]),
  activeBranchId: Type.Union([Type.String(), Type.Null()]),
  selectedBranchId: Type.Union([Type.String(), Type.Null()]),
  snapshot: Type.Object({
    nodeHighWaterMark: Type.Integer({ minimum: 0 }),
    stateRevision: Type.Integer({ minimum: 0 }),
    queueRevision: Type.Integer({ minimum: 0 }),
    capturedAt: Type.Integer({ minimum: 0 }),
    nodeMutationRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    selectedHeadNodeId: Type.Optional(Type.String()),
  }),
  activeRunId: Type.Union([Type.String(), Type.Null()]),
  activeTurnIncomplete: Type.Boolean(),
  queue: Type.Object({
    state: Type.Union([Type.Literal('running'), Type.Literal('paused')]),
    pendingCount: Type.Integer({ minimum: 0 }),
    bodyScope: Type.Union([Type.Literal('included'), Type.Literal('omitted-by-choice')]),
    omittedBodyCount: Type.Integer({ minimum: 0 }),
    items: Type.Array(
      Type.Object({
        followUpId: Type.String(),
        position: Type.Integer({ minimum: 0 }),
        createdAt: Type.Integer({ minimum: 0 }),
        deliveryState: Type.Union([Type.Literal('pending'), Type.Literal('needs_attention')]),
        attentionReason: Type.Optional(
          Type.Union([
            Type.Literal('authorization_ceiling_changed'),
            Type.Literal('profile_revoked'),
            Type.Literal('authority_changed'),
          ]),
        ),
        intent: Type.Optional(Type.Unknown()),
      }),
    ),
  }),
})

export const sessionsToolReadParameters = [
  Type.Object({
    action: Type.Union([
      Type.Literal('read'),
      Type.Literal('status'),
      Type.Literal('queue_list'),
      Type.Literal('requests_list'),
    ]),
    sessionId: Type.String(),
    includeBodies: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    action: Type.Literal('turns'),
    sessionId: Type.String(),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_DISCOVERY_LIMIT })),
    cursor: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('items'),
    sessionId: Type.String(),
    runId: Type.Optional(Type.String()),
    branchScope: Type.Optional(Type.Union([Type.Literal('active-branch'), Type.Literal('tree')])),
    branchId: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_TRANSCRIPT_LIMIT })),
    afterCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    throughCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    snapshotHeadNodeId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal('export'),
    sessionId: Type.String(),
    branchScope: Type.Optional(Type.Union([Type.Literal('active-branch'), Type.Literal('tree')])),
    branchId: Type.Optional(Type.String()),
    includeQueueBodies: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: SESSION_QUERY_TRANSCRIPT_LIMIT })),
    afterCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    throughCreatedOrder: Type.Optional(Type.Integer({ minimum: 0 })),
    snapshotStateRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    capturedAt: Type.Optional(Type.Integer({ minimum: 0 })),
    snapshotManifest: Type.Optional(exportSnapshotManifest),
  }),
] as const
