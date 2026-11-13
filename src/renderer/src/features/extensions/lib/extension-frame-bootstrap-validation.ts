import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import type { OpenWaggleExtensionSyntaxHighlightResult } from '@shared/extension-sdk'
import { getParseIssuePaths, safeDecodeUnknown, Schema } from '@shared/schema'
import { extensionInvokeDeclaredResultSchema } from '@shared/schemas/extension-broker'
import { extensionFrameConfigSchema } from '@shared/schemas/extension-frame'
import type { ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionFrameConfig } from '@shared/types/extension-frame'
import * as Either from 'effect/Either'
import type { OpenWaggleFederatedModule } from './extension-federated-module'

type ExtensionFrameResultType = 'invoke-result' | 'syntax-highlight-result'

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
  | {
      /** A result for `requestId` that failed its decode; the frame still settles that call. */
      readonly type: 'invalid-result'
      readonly resultType: ExtensionFrameResultType
      readonly requestId: string
      readonly issuePaths: readonly string[]
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

const parentControlMessageSchema = Schema.Union(
  Schema.Struct({ ...parentEnvelope, type: Schema.Literal('dispose') }),
  Schema.Struct({
    ...parentEnvelope,
    type: Schema.Literal('configure'),
    config: extensionFrameConfigSchema,
  }),
)

// A result's envelope decodes before the result, so a result that fails its own decode still
// names the call it settles; dropped whole, it would leave the extension's await hanging.
const parentResultMessageSchema = Schema.Struct({
  ...parentEnvelope,
  type: Schema.Literal('invoke-result', 'syntax-highlight-result'),
  requestId: Schema.String,
  result: Schema.Unknown,
})

const decodeInvokeResult = Schema.decodeUnknownEither(extensionInvokeDeclaredResultSchema)
const decodeSyntaxHighlightResult = Schema.decodeUnknownEither(syntaxHighlightResultSchema)

function invalidResult(input: {
  readonly resultType: ExtensionFrameResultType
  readonly requestId: string
  readonly error: unknown
}) {
  const message: ExtensionFrameParentMessage = {
    type: 'invalid-result',
    resultType: input.resultType,
    requestId: input.requestId,
    issuePaths: getParseIssuePaths(input.error) ?? [],
  }
  return message
}

function decodedResultMessage(message: Schema.Schema.Type<typeof parentResultMessageSchema>) {
  const { requestId } = message
  if (message.type === 'invoke-result') {
    const decoded = decodeInvokeResult(message.result)
    const result: ExtensionFrameParentMessage = Either.isRight(decoded)
      ? { type: 'invoke-result', requestId, result: decoded.right }
      : invalidResult({ resultType: message.type, requestId, error: decoded.left })
    return result
  }
  const decoded = decodeSyntaxHighlightResult(message.result)
  const result: ExtensionFrameParentMessage = Either.isRight(decoded)
    ? { type: 'syntax-highlight-result', requestId, result: decoded.right }
    : invalidResult({ resultType: message.type, requestId, error: decoded.left })
  return result
}

/** A message from the parent window for this frame, or `null` for anything else. */
export function decodedParentMessage(value: unknown, frameId: string) {
  const resultMessage = safeDecodeUnknown(parentResultMessageSchema, value)
  if (resultMessage.success) {
    return resultMessage.data.frameId === frameId ? decodedResultMessage(resultMessage.data) : null
  }
  const decoded = safeDecodeUnknown(parentControlMessageSchema, value)
  if (!decoded.success || decoded.data.frameId !== frameId) return null
  const { channel: _channel, frameId: _frameId, ...message } = decoded.data
  const result: ExtensionFrameParentMessage | null = message
  return result
}
