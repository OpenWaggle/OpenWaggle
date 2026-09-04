import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { SESSION_INPUT_LIMITS } from '@shared/session-input-limits'
import {
  HOST_BACKED_MCP_GUI_CHANNELS,
  HOST_UI_REVISION_7_NEW_CHANNELS,
} from '@shared/types/host-ui-protocol'
import {
  isLocalSessionProfileCredential,
  LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH,
} from '@shared/types/local-session-profile'
import {
  LOCAL_SESSION_COMPACTION_REVISION,
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_LEGACY_HOST_UI_REVISION,
  LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH,
  LOCAL_SESSION_MAX_SUPPORTED_REVISIONS,
  LOCAL_SESSION_MCP_HOST_UI_REVISION,
  LOCAL_SESSION_PROTOCOL_NAME,
  LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT,
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
import {
  sessionInputIdSchema,
  sessionInputItemTextSchema,
  sessionInputPathSchema,
  sessionInputTextSchema,
} from './session-input'
import { sessionLifecycleRequestSchema } from './session-lifecycle'
import { sessionQueryRequestSchema } from './session-query'
import { agentSendPayloadSchema } from './validation'
import { waggleConfigSchema } from './waggle'

const localSessionCredentialSchema = Schema.String.pipe(
  Schema.filter((value) => isLocalSessionProfileCredential(value) || 'Invalid credential format.'),
)
const localSessionProfileNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH),
  Schema.filter((value) => value.trim() === value || 'Profile names must be trimmed.'),
)

export const localSessionClientHelloSchema: Schema.Schema<LocalSessionClientHello> = Schema.Struct({
  protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
  supportedRevisions: Schema.Array(Schema.Number.pipe(Schema.int(), Schema.positive())).pipe(
    Schema.minItems(1),
    Schema.maxItems(LOCAL_SESSION_MAX_SUPPORTED_REVISIONS),
  ),
  clientKind: Schema.Literal('gui', 'cli', 'mcp', 'internal'),
  clientVersion: Schema.String.pipe(Schema.maxLength(LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH)),
  workingDirectory: Schema.optional(sessionInputPathSchema),
  profile: Schema.optional(localSessionProfileNameSchema),
  transientAuthority: Schema.optional(localSessionProfileAuthoritySchema),
  credential: Schema.optional(localSessionCredentialSchema),
})

const sessionHostEventCursorSchema = Schema.Struct({
  hostInstanceId: sessionInputIdSchema,
  sequence: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

export const localSessionClientFrameSchema: Schema.Schema<LocalSessionClientFrame> = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('command'),
    requestId: sessionInputIdSchema,
    payload: Schema.Unknown,
  }),
  Schema.Struct({
    kind: Schema.Literal('subscribe'),
    requestId: sessionInputIdSchema,
    after: Schema.optional(sessionHostEventCursorSchema),
    sessionIds: Schema.optional(
      Schema.Array(sessionInputIdSchema).pipe(
        Schema.maxItems(LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT),
      ),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('unsubscribe'),
    requestId: sessionInputIdSchema,
    subscriptionId: sessionInputIdSchema,
  }),
)

export const localSessionCommandPayloadSchema: Schema.Schema<LocalSessionCommandPayload> =
  Schema.Union(
    Schema.Struct({
      contract: Schema.Literal('local-attachments-v1'),
      request: Schema.Struct({
        requestId: sessionInputIdSchema,
        entries: Schema.Array(
          Schema.Struct({
            path: sessionInputPathSchema,
            origin: Schema.optional(Schema.Literal('user-file', 'auto-paste-text')),
          }),
        ).pipe(Schema.maxItems(ATTACHMENT.MAX_COUNT)),
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('local-ui-v1'),
      request: Schema.Struct({
        requestId: sessionInputIdSchema,
        command: Schema.Union(
          Schema.Struct({ operation: Schema.Literal('pin'), sessionId: sessionInputIdSchema }),
          Schema.Struct({ operation: Schema.Literal('unpin'), sessionId: sessionInputIdSchema }),
          Schema.Struct({
            operation: Schema.Literal('move-pin'),
            sessionId: sessionInputIdSchema,
            afterSessionId: Schema.NullOr(sessionInputIdSchema),
            beforeSessionId: Schema.NullOr(sessionInputIdSchema),
          }),
          Schema.Struct({ operation: Schema.Literal('delete'), sessionId: sessionInputIdSchema }),
          Schema.Struct({
            operation: Schema.Literal('dismiss-interrupted-run'),
            sessionId: sessionInputIdSchema,
            runId: sessionInputIdSchema,
          }),
          Schema.Struct({
            operation: Schema.Literal('navigate-tree'),
            sessionId: sessionInputIdSchema,
            model: sessionInputIdSchema,
            targetNodeId: sessionInputIdSchema,
            options: Schema.optional(
              Schema.Struct({
                summarize: Schema.optional(Schema.Boolean),
                customInstructions: Schema.optional(sessionInputTextSchema),
              }),
            ),
          }),
          Schema.Struct({
            operation: Schema.Literal('rename-branch'),
            sessionId: sessionInputIdSchema,
            branchId: sessionInputIdSchema,
            name: sessionInputItemTextSchema,
          }),
          Schema.Struct({
            operation: Schema.Literal('archive-branch'),
            sessionId: sessionInputIdSchema,
            branchId: sessionInputIdSchema,
          }),
          Schema.Struct({
            operation: Schema.Literal('restore-branch'),
            sessionId: sessionInputIdSchema,
            branchId: sessionInputIdSchema,
          }),
          Schema.Struct({
            operation: Schema.Literal('update-tree-ui-state'),
            sessionId: sessionInputIdSchema,
            patch: Schema.Struct({
              expandedNodeIds: Schema.optional(
                Schema.Array(sessionInputIdSchema).pipe(
                  Schema.maxItems(SESSION_INPUT_LIMITS.expandedTreeNodeItems),
                ),
              ),
              branchesSidebarCollapsed: Schema.optional(Schema.Boolean),
              lastVisitedAt: Schema.optional(
                Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
              ),
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
      transport: Schema.optional(
        Schema.Struct({
          attachmentPaths: Schema.Array(sessionInputPathSchema).pipe(
            Schema.maxItems(ATTACHMENT.MAX_COUNT),
          ),
        }),
      ),
    }),
    Schema.Struct({
      contract: Schema.Literal('session-lifecycle-v2'),
      request: sessionLifecycleRequestSchema,
      transport: Schema.optional(
        Schema.Struct({
          attachmentPaths: Schema.Array(sessionInputPathSchema).pipe(
            Schema.maxItems(ATTACHMENT.MAX_COUNT),
          ),
        }),
      ),
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
        requestId: sessionInputIdSchema,
        sessionId: sessionInputIdSchema,
        model: sessionInputIdSchema,
        customInstructions: Schema.optional(sessionInputTextSchema),
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('local-compaction-cancel-v1'),
      request: Schema.Struct({
        requestId: sessionInputIdSchema,
        sessionId: sessionInputIdSchema,
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('session-waggle-v1'),
      request: Schema.Struct({
        contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
        requestId: sessionInputIdSchema,
        idempotencyKey: sessionInputIdSchema,
        sessionId: sessionInputIdSchema,
        payload: agentSendPayloadSchema,
        model: sessionInputIdSchema,
        config: waggleConfigSchema,
      }),
    }),
    Schema.Struct({
      contract: Schema.Literal('session-waggle-cancel-v1'),
      request: Schema.Struct({
        contractVersion: Schema.Literal(SESSION_WAGGLE_CONTRACT_VERSION),
        requestId: sessionInputIdSchema,
        sessionId: sessionInputIdSchema,
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
      ? HOST_UI_REVISION_7_NEW_CHANNELS.some((channel) => channel === payload.request.channel)
        ? LOCAL_SESSION_CURRENT_REVISION
        : HOST_BACKED_MCP_GUI_CHANNELS.some((channel) => channel === payload.request.channel)
          ? LOCAL_SESSION_MCP_HOST_UI_REVISION
          : LOCAL_SESSION_LEGACY_HOST_UI_REVISION
      : payload.contract === 'local-compaction-v1' ||
          payload.contract === 'local-compaction-cancel-v1'
        ? LOCAL_SESSION_COMPACTION_REVISION
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
