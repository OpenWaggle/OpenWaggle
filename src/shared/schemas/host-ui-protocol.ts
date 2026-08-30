import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import {
  HOST_BACKED_GUI_CHANNELS,
  HOST_UI_CONTRACT_VERSION,
  type HostUiV1Request,
  type HostUiV1Result,
} from '@shared/types/host-ui-protocol'

export const hostBackedGuiChannelSchema = Schema.Literal(...HOST_BACKED_GUI_CHANNELS)

export const hostUiV1RequestSchema: Schema.Schema<HostUiV1Request> = Schema.Struct({
  contractVersion: Schema.Literal(HOST_UI_CONTRACT_VERSION),
  requestId: Schema.String,
  channel: hostBackedGuiChannelSchema,
  args: Schema.Array(Schema.Unknown),
})

export const hostUiV1ResultSchema: Schema.Schema<HostUiV1Result> = Schema.Struct({
  contractVersion: Schema.Literal(HOST_UI_CONTRACT_VERSION),
  requestId: Schema.String,
  channel: hostBackedGuiChannelSchema,
  result: Schema.Unknown,
})

export function decodeHostUiV1Request(value: unknown) {
  return decodeUnknownExactOrThrow(hostUiV1RequestSchema, value)
}

export function decodeHostUiV1Result(value: unknown) {
  return decodeUnknownExactOrThrow(hostUiV1ResultSchema, value)
}
