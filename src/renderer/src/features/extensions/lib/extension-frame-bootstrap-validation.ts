import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import type { OpenWaggleExtensionSyntaxHighlightResult } from '@shared/extension-sdk'
import { safeDecodeUnknown, Schema } from '@shared/schema'
import { extensionInvokeDeclaredResultSchema } from '@shared/schemas/extension-broker'
import { extensionFrameConfigSchema } from '@shared/schemas/extension-frame'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionFrameConfig } from '@shared/types/extension-frame'
import type { OpenWaggleFederatedModule } from './extension-federated-module'

export type ExtensionFrameParentMessage =
  | { readonly type: 'configure'; readonly config: ExtensionFrameConfig }
  | { readonly type: 'dispose' }
  | {
      readonly type: 'invoke-result'
      readonly requestId: string
      readonly result: ExtensionInvokeResult
    }
  | {
      readonly type: 'syntax-highlight-result'
      readonly requestId: string
      readonly result: OpenWaggleExtensionSyntaxHighlightResult
    }

function moduleMountExport(value: object) {
  const result: unknown = Object.getOwnPropertyDescriptor(value, 'mount')?.value
  return result
}

export function isFederatedModule(value: unknown): value is OpenWaggleFederatedModule {
  return (
    typeof value === 'object' && value !== null && typeof moduleMountExport(value) === 'function'
  )
}

const optionalString = Schema.optionalWith(Schema.String, { exact: true })

const syntaxHighlightResultSchema: Schema.Schema<OpenWaggleExtensionSyntaxHighlightResult> =
  Schema.Struct({
    status: Schema.Literal('highlighted', 'plain-text'),
    language: Schema.String,
    foreground: optionalString,
    background: optionalString,
    diagnostic: optionalString,
    lines: Schema.Array(
      Schema.Array(
        Schema.Struct({
          content: Schema.String,
          color: optionalString,
          backgroundColor: optionalString,
          fontStyle: Schema.optionalWith(Schema.Number, { exact: true }),
        }),
      ),
    ),
  })

const parentEnvelope = {
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
}

const parentMessageSchema = Schema.Union(
  Schema.Struct({ ...parentEnvelope, type: Schema.Literal('dispose') }),
  Schema.Struct({
    ...parentEnvelope,
    type: Schema.Literal('configure'),
    config: extensionFrameConfigSchema,
  }),
  Schema.Struct({
    ...parentEnvelope,
    type: Schema.Literal('invoke-result'),
    requestId: Schema.String,
    result: extensionInvokeDeclaredResultSchema,
  }),
  Schema.Struct({
    ...parentEnvelope,
    type: Schema.Literal('syntax-highlight-result'),
    requestId: Schema.String,
    result: syntaxHighlightResultSchema,
  }),
)

/** A message from the parent window for this frame, or `null` for anything else. */
export function decodedParentMessage(value: unknown, frameId: string) {
  const decoded = safeDecodeUnknown(parentMessageSchema, value)
  if (!decoded.success || decoded.data.frameId !== frameId) return null
  const { channel: _channel, frameId: _frameId, ...message } = decoded.data
  const result: ExtensionFrameParentMessage | null = message
  return result
}
