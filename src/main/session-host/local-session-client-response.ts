import { match } from '@diegogbrisa/ts-match'
import {
  decodeUnknownExactOrThrow,
  Schema,
  safeDecodeUnknown,
  type SchemaType,
} from '@shared/schema'
import { decodeDesktopServiceResponse } from '@shared/schemas/desktop-service'
import { decodeHostUiV1Result } from '@shared/schemas/host-ui-protocol'
import { decodeLocalHostResponse } from '@shared/schemas/local-host'
import { decodeLocalSessionProfileManagementResponse } from '@shared/schemas/local-session-profile-management'
import { decodeLocalUpdateResponse } from '@shared/schemas/local-update'
import { decodeScheduledTasksResponse } from '@shared/schemas/scheduled-task'
import { decodeSessionControlMutationResponse } from '@shared/schemas/session-control'
import { decodeSessionLifecycleResponse } from '@shared/schemas/session-lifecycle'
import {
  localAttachmentsResponseSchema,
  localCompactionCancellationResponseSchema,
  localCompactionResponseSchema,
  localSessionCommandResponsePayloadSchema,
  localUiResponseSchema,
  sessionQueryResponseSchema,
  sessionWaggleCancellationResponseSchema,
  sessionWaggleResponseSchema,
} from '@shared/schemas/local-session-command-response'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { localSessionClientProtocolError } from './local-session-client-protocol-error'

type LocalSessionCommandResponsePayload = SchemaType<
  typeof localSessionCommandResponsePayloadSchema
>

const commandFrameSchema = Schema.Struct({
  kind: Schema.String,
  requestId: Schema.optionalWith(Schema.Unknown, { exact: true }),
  payload: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

/** Decodes one contract's response, naming the fields that did not match. */
function decodeResponse<A, I>(schema: Schema.Schema<A, I>, value: unknown, label: string) {
  const decoded = safeDecodeUnknown(schema, value)
  if (!decoded.success) throw new Error(`Invalid ${label} response: ${decoded.issues.join('; ')}`)
  return decoded.data
}

function decodeCommandPayload(payload: LocalSessionCommandResponsePayload) {
  const result: LocalSessionCommandResult = match(payload.contract)
    .with('desktop-service-v1', () => ({
      contract: 'desktop-service-v1' as const,
      response: decodeDesktopServiceResponse(payload.response),
    }))
    .with('local-attachments-v1', () => {
      const response = decodeUnknownExactOrThrow(localAttachmentsResponseSchema, payload.response)
      return { contract: 'local-attachments-v1' as const, response }
    })
    .with('local-ui-v1', () => ({
      contract: 'local-ui-v1' as const,
      response: decodeResponse(localUiResponseSchema, payload.response, 'Local UI'),
    }))
    .with('local-access-v1', () => ({
      contract: 'local-access-v1' as const,
      response: decodeLocalSessionProfileManagementResponse(payload.response),
    }))
    .with('session-control-v2', () => ({
      contract: 'session-control-v2' as const,
      response: decodeSessionControlMutationResponse(payload.response),
    }))
    .with('session-lifecycle-v2', () => ({
      contract: 'session-lifecycle-v2' as const,
      response: decodeSessionLifecycleResponse(payload.response),
    }))
    .with('session-query-v2', () => ({
      contract: 'session-query-v2' as const,
      response: decodeResponse(sessionQueryResponseSchema, payload.response, 'query'),
    }))
    .with('host-ui-v1', () => ({
      contract: 'host-ui-v1' as const,
      response: decodeHostUiV1Result(payload.response),
    }))
    .with('local-update-v1', () => ({
      contract: 'local-update-v1' as const,
      response: decodeLocalUpdateResponse(payload.response),
    }))
    .with('local-host-v1', () => ({
      contract: 'local-host-v1' as const,
      response: decodeLocalHostResponse(payload.response),
    }))
    .with('session-waggle-v1', () => ({
      contract: 'session-waggle-v1' as const,
      response: decodeResponse(sessionWaggleResponseSchema, payload.response, 'Waggle'),
    }))
    .with('session-waggle-cancel-v1', () => ({
      contract: 'session-waggle-cancel-v1' as const,
      response: decodeResponse(
        sessionWaggleCancellationResponseSchema,
        payload.response,
        'Waggle cancellation',
      ),
    }))
    .with('local-compaction-v1', () => ({
      contract: 'local-compaction-v1' as const,
      response: decodeResponse(localCompactionResponseSchema, payload.response, 'Local compaction'),
    }))
    .with('local-compaction-cancel-v1', () => ({
      contract: 'local-compaction-cancel-v1' as const,
      response: decodeResponse(
        localCompactionCancellationResponseSchema,
        payload.response,
        'Local compaction cancellation',
      ),
    }))
    .with('scheduled-tasks-v1', () => ({
      contract: 'scheduled-tasks-v1' as const,
      response: decodeScheduledTasksResponse(payload.response),
    }))
    .otherwise(() => {
      throw new Error('Local Session Host returned an invalid command contract.')
    })
  return result
}

export function decodeLocalSessionCommandResponse(value: unknown, requestId: string) {
  const frame = safeDecodeUnknown(commandFrameSchema, value)
  if (!frame.success) throw new Error('Local Session Host returned an invalid command frame.')
  if (frame.data.kind === 'error') {
    throw localSessionClientProtocolError(value, 'Local Session command failed.')
  }
  if (frame.data.kind !== 'response' || frame.data.requestId !== requestId) {
    throw new Error('Local Session Host returned an unexpected command response.')
  }
  const { payload } = frame.data
  // A payload without a `response` member is malformed even though the member is `unknown`.
  const payloadHasResponse =
    typeof payload === 'object' && payload !== null && 'response' in payload
  const decoded = safeDecodeUnknown(localSessionCommandResponsePayloadSchema, payload)
  if (!payloadHasResponse || !decoded.success) {
    throw new Error('Local Session Host returned an invalid command payload.')
  }
  return decodeCommandPayload(decoded.data)
}
