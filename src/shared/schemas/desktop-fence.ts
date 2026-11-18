import { Schema } from '../schema'

export const DESKTOP_FENCE_IDENTIFIER_LENGTH = 256
export const DESKTOP_FENCE_SCOPE_LENGTH = 4096

const identifier = Schema.NonEmptyString.pipe(Schema.maxLength(DESKTOP_FENCE_IDENTIFIER_LENGTH))
const scopeValue = Schema.NonEmptyString.pipe(Schema.maxLength(DESKTOP_FENCE_SCOPE_LENGTH))

export const desktopMutationScopeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('owner'), ownerKey: scopeValue }),
  Schema.Struct({ kind: Schema.Literal('path'), directoryPath: scopeValue }),
)

export const desktopFenceRecordSchema = Schema.Struct({
  token: identifier,
  hostInstanceId: identifier,
  scope: desktopMutationScopeSchema,
  state: Schema.Literal('active', 'released'),
})
