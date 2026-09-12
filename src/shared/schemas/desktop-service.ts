import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  DESKTOP_SERVICE_LIMITS,
  type DesktopServiceRequest,
  type DesktopServiceResponse,
} from '@shared/types/desktop-service'
import { desktopBrowserCommandSchema, desktopBrowserResultSchema } from './desktop-browser-service'
import {
  DESKTOP_FENCE_IDENTIFIER_LENGTH,
  DESKTOP_FENCE_SCOPE_LENGTH,
  desktopFenceRecordSchema,
} from './desktop-fence'
import {
  desktopTerminalCommandSchema,
  desktopTerminalResultSchema,
} from './desktop-terminal-service'

const id = Schema.NonEmptyString.pipe(Schema.maxLength(DESKTOP_FENCE_IDENTIFIER_LENGTH))
const ownerKey = Schema.NonEmptyString.pipe(Schema.maxLength(DESKTOP_FENCE_SCOPE_LENGTH))
const fences = Schema.Array(desktopFenceRecordSchema).pipe(
  Schema.maxItems(DESKTOP_SERVICE_LIMITS.fenceRecords),
)

export const desktopServiceCommandSchema = Schema.Union(
  desktopBrowserCommandSchema,
  desktopTerminalCommandSchema,
  Schema.Struct({
    service: Schema.Literal('fence'),
    operation: Schema.Literal('acquire'),
    record: desktopFenceRecordSchema,
  }),
  Schema.Struct({
    service: Schema.Literal('browser'),
    operation: Schema.Literal('deleteOwner'),
    ownerKey,
  }),
)

export const desktopServiceResultSchema = Schema.Union(
  desktopBrowserResultSchema,
  desktopTerminalResultSchema,
  Schema.Struct({
    service: Schema.Literal('fence'),
    operation: Schema.Literal('acquire'),
    value: Schema.Null,
  }),
  Schema.Struct({
    service: Schema.Literal('browser'),
    operation: Schema.Literal('deleteOwner'),
    value: Schema.Null,
  }),
)

export const desktopServiceRequestSchema = Schema.Union(
  Schema.Struct({ operation: Schema.Literal('markClosed'), guiInstanceId: id, hostInstanceId: id }),
  Schema.Struct({ operation: Schema.Literal('register'), guiInstanceId: id }),
  Schema.Struct({
    operation: Schema.Literal('ready'),
    leaseId: id,
    fenceTokens: Schema.Array(id).pipe(Schema.maxItems(DESKTOP_SERVICE_LIMITS.fenceRecords)),
  }),
  Schema.Struct({ operation: Schema.Literal('poll'), leaseId: id }),
  Schema.Struct({
    operation: Schema.Literal('heartbeat', 'prepareDisconnect', 'resumeDesktop'),
    leaseId: id,
  }),
  Schema.Struct({
    operation: Schema.Literal('complete'),
    leaseId: id,
    completion: Schema.Union(
      Schema.Struct({
        commandId: id,
        outcome: Schema.Literal('success'),
        result: desktopServiceResultSchema,
      }),
      Schema.Struct({
        commandId: id,
        outcome: Schema.Literal('failure'),
        message: Schema.String.pipe(Schema.maxLength(DESKTOP_SERVICE_LIMITS.errorLength)),
        uncertain: Schema.optional(Schema.Boolean),
      }),
    ),
  }),
  Schema.Struct({
    operation: Schema.Literal('acknowledgeReleased'),
    leaseId: id,
    token: id,
    hostInstanceId: id,
  }),
  Schema.Struct({ operation: Schema.Literal('disconnect'), leaseId: id }),
)

export const desktopServiceResponseSchema = Schema.Union(
  Schema.Struct({
    operation: Schema.Literal('quarantined'),
    reason: Schema.Literal('previous-owner-unclean'),
  }),
  Schema.Struct({ operation: Schema.Literal('register'), leaseId: id, hostInstanceId: id, fences }),
  Schema.Struct({
    operation: Schema.Literal('poll'),
    commands: Schema.Array(
      Schema.Struct({
        commandId: id,
        leaseId: id,
        deadline: Schema.Number.pipe(Schema.int(), Schema.positive()),
        command: desktopServiceCommandSchema,
      }),
    ).pipe(Schema.maxItems(DESKTOP_SERVICE_LIMITS.batchCommands)),
    cancelledCommandIds: Schema.Array(id).pipe(
      Schema.maxItems(DESKTOP_SERVICE_LIMITS.pendingCommands),
    ),
    fences,
  }),
  Schema.Struct({
    operation: Schema.Literal('prepareDisconnect'),
    accepted: Schema.Literal(true),
    fences,
  }),
  Schema.Struct({
    operation: Schema.Literal(
      'ready',
      'complete',
      'acknowledgeReleased',
      'disconnect',
      'markClosed',
      'heartbeat',
      'resumeDesktop',
    ),
    accepted: Schema.Boolean,
  }),
)

export function decodeDesktopServiceRequest(value: unknown): DesktopServiceRequest {
  try {
    return decodeUnknownExactOrThrow(desktopServiceRequestSchema, value)
  } catch {
    throw new Error('Invalid desktop-service request.')
  }
}

export function decodeDesktopServiceResponse(value: unknown): DesktopServiceResponse {
  try {
    return decodeUnknownExactOrThrow(desktopServiceResponseSchema, value)
  } catch {
    throw new Error('Invalid desktop-service response.')
  }
}
