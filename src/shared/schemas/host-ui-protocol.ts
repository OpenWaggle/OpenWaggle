import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { HOST_BACKED_GUI_CHANNELS, HOST_UI_CONTRACT_VERSION } from '@shared/types/host-ui-protocol'

export const hostBackedGuiChannelSchema = Schema.Literal(...HOST_BACKED_GUI_CHANNELS)

export const hostUiWireValueSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('undefined') }),
  /** Value is validated as JSON-compatible before crossing the framed transport. */
  Schema.Struct({ kind: Schema.Literal('value'), value: Schema.Unknown }),
)

export const hostUiV1RequestSchema = Schema.Struct({
  contractVersion: Schema.Literal(HOST_UI_CONTRACT_VERSION),
  requestId: Schema.String,
  channel: hostBackedGuiChannelSchema,
  args: Schema.Array(hostUiWireValueSchema),
})

export const hostUiV1ResultSchema = Schema.Struct({
  contractVersion: Schema.Literal(HOST_UI_CONTRACT_VERSION),
  requestId: Schema.String,
  channel: hostBackedGuiChannelSchema,
  result: hostUiWireValueSchema,
})

export function decodeHostUiV1Request(value: unknown) {
  return decodeUnknownExactOrThrow(hostUiV1RequestSchema, value)
}

export function decodeHostUiV1Result(value: unknown) {
  return decodeUnknownExactOrThrow(hostUiV1ResultSchema, value)
}
