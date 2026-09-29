import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  LOCAL_HOST_CONTRACT_VERSION,
  type LocalHostRequest,
  type LocalHostResponse,
} from '@shared/types/local-host'

export const localHostRequestSchema: Schema.Schema<LocalHostRequest> = Schema.Struct({
  contractVersion: Schema.Literal(LOCAL_HOST_CONTRACT_VERSION),
  operation: Schema.Literal('stop'),
})

export const localHostResponseSchema: Schema.Schema<LocalHostResponse> = Schema.Struct({
  contractVersion: Schema.Literal(LOCAL_HOST_CONTRACT_VERSION),
  operation: Schema.Literal('stop'),
  hostInstanceId: Schema.String,
  blockingRuns: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  blockingActions: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
})

export function decodeLocalHostResponse(value: unknown) {
  return decodeUnknownExactOrThrow(localHostResponseSchema, value)
}
