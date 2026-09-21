import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  LOCAL_UPDATE_CONTRACT_VERSION,
  type LocalUpdateRequest,
  type LocalUpdateResponse,
} from '@shared/types/local-update'
import { UPDATE_CHANNELS } from '@shared/types/update-channel'

export const localUpdateRequestSchema: Schema.Schema<LocalUpdateRequest> = Schema.Union(
  Schema.Struct({
    contractVersion: Schema.Literal(LOCAL_UPDATE_CONTRACT_VERSION),
    operation: Schema.Literal('get-channel'),
  }),
  Schema.Struct({
    contractVersion: Schema.Literal(LOCAL_UPDATE_CONTRACT_VERSION),
    operation: Schema.Literal('set-channel'),
    channel: Schema.Literal(...UPDATE_CHANNELS),
  }),
)

export const localUpdateResponseSchema: Schema.Schema<LocalUpdateResponse> = Schema.Struct({
  contractVersion: Schema.Literal(LOCAL_UPDATE_CONTRACT_VERSION),
  updateChannel: Schema.Literal(...UPDATE_CHANNELS),
})

export function decodeLocalUpdateResponse(value: unknown) {
  return decodeUnknownExactOrThrow(localUpdateResponseSchema, value)
}
