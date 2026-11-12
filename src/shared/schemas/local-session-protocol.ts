import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'

import {
  isLocalSessionProfileCredential,
  LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH,
} from '@shared/types/local-session-profile'
import {
  LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH,
  LOCAL_SESSION_MAX_SUPPORTED_REVISIONS,
  LOCAL_SESSION_PROTOCOL_NAME,
  LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT,
  SESSION_WAGGLE_CONTRACT_VERSION,
} from '@shared/types/local-session-protocol'
import { desktopServiceRequestSchema } from './desktop-service'
import { hostUiV1RequestSchema } from './host-ui-protocol'
import { localHostRequestSchema } from './local-host'
import { requiredLocalSessionCommandRevision } from './local-session-command-revision'
import { localSessionNegotiationResultSchema } from './local-session-negotiation'
import { localSessionProfileAuthoritySchema } from './local-session-profile'
import { localSessionProfileManagementRequestSchema } from './local-session-profile-management'
import { localUiCommandSchema } from './local-ui-command'
import { localUpdateRequestSchema } from './local-update'
import { scheduledTasksRequestSchema } from './scheduled-task'
import { sessionHostEventCursorSchema } from './session-host-event-cursor'
import { sessionControlMutationRequestSchema } from './session-control'
import {
  sessionInputIdSchema,
  sessionInputPathSchema,
  sessionInputTextSchema,
} from './session-input'
import { sessionLifecycleRequestSchema } from './session-lifecycle'
import { sessionQueryRequestSchema } from './session-query'
import { agentSendPayloadSchema, browserPreviewAttachmentSchema } from './validation'
import { waggleConfigSchema } from './waggle'

const localSessionCredentialSchema = Schema.String.pipe(
  Schema.filter((value) => isLocalSessionProfileCredential(value) || 'Invalid credential format.'),
)
const localSessionProfileNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(LOCAL_SESSION_PROFILE_NAME_MAX_LENGTH),
  Schema.filter((value) => value.trim() === value || 'Profile names must be trimmed.'),
)

export const localSessionClientHelloSchema = Schema.Struct({
  protocol: Schema.Literal(LOCAL_SESSION_PROTOCOL_NAME),
  supportedRevisions: Schema.Array(Schema.Number.pipe(Schema.int(), Schema.positive())).pipe(
    Schema.minItems(1),
    Schema.maxItems(LOCAL_SESSION_MAX_SUPPORTED_REVISIONS),
  ),
  clientKind: Schema.Literal('gui', 'cli', 'mcp', 'internal'),
  clientVersion: Schema.String.pipe(Schema.maxLength(LOCAL_SESSION_MAX_CLIENT_VERSION_LENGTH)),
  workingDirectory: Schema.optionalWith(sessionInputPathSchema, { exact: true }),
  profile: Schema.optionalWith(localSessionProfileNameSchema, { exact: true }),
  transientAuthority: Schema.optionalWith(localSessionProfileAuthoritySchema, { exact: true }),
  credential: Schema.optionalWith(localSessionCredentialSchema, { exact: true }),
})

export const localSessionClientFrameSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('command'),
    requestId: sessionInputIdSchema,
    payload: Schema.Unknown,
  }),
  Schema.Struct({
    kind: Schema.Literal('subscribe'),
    requestId: sessionInputIdSchema,
    after: Schema.optionalWith(sessionHostEventCursorSchema, { exact: true }),
    sessionIds: Schema.optionalWith(
      Schema.Array(sessionInputIdSchema).pipe(
        Schema.maxItems(LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT),
      ),
      { exact: true },
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('unsubscribe'),
    requestId: sessionInputIdSchema,
    subscriptionId: sessionInputIdSchema,
  }),
)

export const localSessionCommandPayloadSchema = Schema.Union(
  Schema.Struct({
    contract: Schema.Literal('desktop-service-v1'),
    request: desktopServiceRequestSchema,
  }),
  Schema.Struct({
    contract: Schema.Literal('local-attachments-v1'),
    request: Schema.Struct({
      requestId: sessionInputIdSchema,
      entries: Schema.Array(
        Schema.Struct({
          path: sessionInputPathSchema,
          origin: Schema.optionalWith(
            Schema.Literal('user-file', 'auto-paste-text', 'browser-preview', 'session-resource'),
            { exact: true },
          ),
          browserPreview: Schema.optionalWith(browserPreviewAttachmentSchema, { exact: true }),
          browserAnnotationText: Schema.optionalWith(
            Schema.String.pipe(Schema.maxLength(ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)),
            { exact: true },
          ),
        }),
      ).pipe(Schema.maxItems(ATTACHMENT.MAX_COUNT)),
    }),
  }),
  Schema.Struct({
    contract: Schema.Literal('local-ui-v1'),
    request: Schema.Struct({
      requestId: sessionInputIdSchema,
      command: localUiCommandSchema,
    }),
  }),
  Schema.Struct({
    contract: Schema.Literal('local-access-v1'),
    request: localSessionProfileManagementRequestSchema,
  }),
  Schema.Struct({
    contract: Schema.Literal('session-control-v2'),
    request: sessionControlMutationRequestSchema,
    transport: Schema.optionalWith(
      Schema.Struct({
        attachmentPaths: Schema.Array(sessionInputPathSchema).pipe(
          Schema.maxItems(ATTACHMENT.MAX_COUNT),
        ),
      }),
      { exact: true },
    ),
  }),
  Schema.Struct({
    contract: Schema.Literal('session-lifecycle-v2'),
    request: sessionLifecycleRequestSchema,
    transport: Schema.optionalWith(
      Schema.Struct({
        attachmentPaths: Schema.Array(sessionInputPathSchema).pipe(
          Schema.maxItems(ATTACHMENT.MAX_COUNT),
        ),
      }),
      { exact: true },
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
    contract: Schema.Literal('local-update-v1'),
    request: localUpdateRequestSchema,
  }),
  Schema.Struct({
    contract: Schema.Literal('local-host-v1'),
    request: localHostRequestSchema,
  }),
  Schema.Struct({
    contract: Schema.Literal('local-compaction-v1'),
    request: Schema.Struct({
      requestId: sessionInputIdSchema,
      sessionId: sessionInputIdSchema,
      model: sessionInputIdSchema,
      customInstructions: Schema.optionalWith(sessionInputTextSchema, { exact: true }),
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
  Schema.Struct({
    contract: Schema.Literal('scheduled-tasks-v1'),
    request: scheduledTasksRequestSchema,
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
  const requiredRevision = requiredLocalSessionCommandRevision(payload)
  if (requiredRevision !== undefined && revision < requiredRevision) {
    throw new Error(`This command requires Local Session protocol revision ${requiredRevision}.`)
  }
  return payload
}

export function decodeLocalSessionNegotiationResult(value: unknown) {
  return decodeUnknownExactOrThrow(localSessionNegotiationResultSchema, value)
}
