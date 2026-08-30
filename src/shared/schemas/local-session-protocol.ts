import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  LOCAL_SESSION_PROTOCOL_NAME,
  LOCAL_SESSION_SUPPORTED_REVISIONS,
  LOCAL_SESSION_WAGGLE_REVISION,
  type LocalSessionClientFrame,
  type LocalSessionClientHello,
  type LocalSessionCommandPayload,
  SESSION_WAGGLE_CONTRACT_VERSION,
} from '@shared/types/local-session-protocol'
import { hostUiV1RequestSchema } from './host-ui-protocol'
import { localSessionNegotiationResultSchema } from './local-session-negotiation'
import { localSessionProfileAuthoritySchema } from './local-session-profile'
import { localSessionProfileManagementRequestSchema } from './local-session-profile-management'
import { sessionControlMutationRequestSchema } from './session-control'
import { sessionLifecycleRequestSchema } from './session-lifecycle'
import { sessionQueryRequestSchema } from './session-query'
import { agentSendPayloadSchema } from './validation'
import { waggleConfigSchema } from './waggle'

const [currentRevision, previousRevision] = LOCAL_SESSION_SUPPORTED_REVISIONS

export const localSessionClientHelloSchema: Schema.Schema<LocalSessionClientHello> = Schema.Struct({
  protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
  supportedRevisions: Schema.Array(Schema.Number.pipe(Schema.int(), Schema.positive())),
  clientKind: Schema.Literal('gui', 'cli', 'mcp', 'internal'),
  clientVersion: Schema.String,
  workingDirectory: Schema.optional(Schema.String),
  profile: Schema.optional(Schema.String),
  transientAuthority: Schema.optional(localSessionProfileAuthoritySchema),
  credential: Schema.optional(Schema.String),
})

const sessionHostEventCursorSchema = Schema.Struct({
  hostInstanceId: Schema.String,
  sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

export const localSessionClientFrameSchema: Schema.Schema<LocalSessionClientFrame> = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('command'),
    requestId: Schema.String,
    payload: Schema.Unknown,
  }),
  Schema.Struct({
    kind: Schema.Literal('subscribe'),
    requestId: Schema.String,
    after: Schema.optional(sessionHostEventCursorSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('unsubscribe'),
    requestId: Schema.String,
    subscriptionId: Schema.String,
  }),
)

export const localSessionCommandPayloadSchema: Schema.Schema<LocalSessionCommandPayload> =
  Schema.Union(
    Schema.Struct({
      contract: Schema.Literal('local-attachments-v1'),
      request: Schema.Struct({
        requestId: Schema.String,
        entries: Schema.Array(
          Schema.Struct({
            path: Schema.String,
            origin: Schema.optional(Schema.Literal('user-file', 'auto-paste-text')),
          }),
        ),
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('local-ui-v1'),
      request: Schema.Struct({
        requestId: Schema.String,
        command: Schema.Union(
          Schema.Struct({ operation: Schema.Literal('pin'), sessionId: Schema.String }),
          Schema.Struct({ operation: Schema.Literal('unpin'), sessionId: Schema.String }),
          Schema.Struct({
            operation: Schema.Literal('move-pin'),
            sessionId: Schema.String,
            afterSessionId: Schema.NullOr(Schema.String),
            beforeSessionId: Schema.NullOr(Schema.String),
          }),
          Schema.Struct({ operation: Schema.Literal('delete'), sessionId: Schema.String }),
          Schema.Struct({
            operation: Schema.Literal('dismiss-interrupted-run'),
            sessionId: Schema.String,
            runId: Schema.String,
          }),
          Schema.Struct({
            operation: Schema.Literal('navigate-tree'),
            sessionId: Schema.String,
            model: Schema.String,
            targetNodeId: Schema.String,
            options: Schema.optional(
              Schema.Struct({
                summarize: Schema.optional(Schema.Boolean),
                customInstructions: Schema.optional(Schema.String),
              }),
            ),
          }),
          Schema.Struct({
            operation: Schema.Literal('rename-branch'),
            sessionId: Schema.String,
            branchId: Schema.String,
            name: Schema.String,
          }),
          Schema.Struct({
            operation: Schema.Literal('archive-branch'),
            sessionId: Schema.String,
            branchId: Schema.String,
          }),
          Schema.Struct({
            operation: Schema.Literal('restore-branch'),
            sessionId: Schema.String,
            branchId: Schema.String,
          }),
          Schema.Struct({
            operation: Schema.Literal('update-tree-ui-state'),
            sessionId: Schema.String,
            patch: Schema.Struct({
              expandedNodeIds: Schema.optional(Schema.Array(Schema.String)),
              branchesSidebarCollapsed: Schema.optional(Schema.Boolean),
            }),
          }),
        ),
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('local-access-v1'),
      request: localSessionProfileManagementRequestSchema,
    }),
    Schema.Struct({
      contract: Schema.Literal('session-control-v2'),
      request: sessionControlMutationRequestSchema,
      transport: Schema.optional(Schema.Struct({ attachmentPaths: Schema.Array(Schema.String) })),
    }),
    Schema.Struct({
      contract: Schema.Literal('session-lifecycle-v2'),
      request: sessionLifecycleRequestSchema,
      transport: Schema.optional(Schema.Struct({ attachmentPaths: Schema.Array(Schema.String) })),
    }),
    Schema.Struct({
      contract: Schema.Literal('session-query-v2'),
      request: sessionQueryRequestSchema,
    }),
    Schema.Struct({
      contract: Schema.Literal('host-ui-v1'),
      request: hostUiV1RequestSchema,
    }),
    Schema.Struct({
      contract: Schema.Literal('local-compaction-v1'),
      request: Schema.Struct({
        requestId: Schema.String,
        sessionId: Schema.String,
        model: Schema.String,
        customInstructions: Schema.optional(Schema.String),
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('local-compaction-cancel-v1'),
      request: Schema.Struct({
        requestId: Schema.String,
        sessionId: Schema.String,
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('session-waggle-v1'),
      request: Schema.Struct({
        contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
        requestId: Schema.String,
        idempotencyKey: Schema.String,
        sessionId: Schema.String,
        payload: agentSendPayloadSchema,
        model: Schema.String,
        config: waggleConfigSchema,
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('session-waggle-cancel-v1'),
      request: Schema.Struct({
        contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
        requestId: Schema.String,
        sessionId: Schema.String,
      }),
    }),
  )

export function decodeLocalSessionClientHello(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionClientHelloSchema, value)
}

export function decodeLocalSessionClientFrame(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionClientFrameSchema, value)
}

export function decodeLocalSessionCommandPayload(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionCommandPayloadSchema, value)
}

export function decodeLocalSessionCommandPayloadForRevision(value: unknown, revision: number) {
  const payload = decodeLocalSessionCommandPayload(value)
  const requiredRevision =
    payload.contract === 'host-ui-v1'
      ? currentRevision
      : payload.contract === 'local-compaction-v1' ||
          payload.contract === 'local-compaction-cancel-v1'
        ? previousRevision
        : payload.contract === 'session-waggle-v1' ||
            payload.contract === 'session-waggle-cancel-v1'
          ? LOCAL_SESSION_WAGGLE_REVISION
          : undefined
  if (requiredRevision !== undefined && revision < requiredRevision) {
    throw new Error(`This command requires Local Session protocol revision ${requiredRevision}.`)
  }
  return payload
}

export function decodeLocalSessionNegotiationResult(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionNegotiationResultSchema, value)
}
