import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { EXTENSION_FRAME_MESSAGE_CHANNEL } from '@shared/constants/extension-frame'
import { createOpenWaggleExtensionSurfaceContext } from '@shared/extension-context'
import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { extensionInvokeScopeSchema } from '@shared/schemas/extension-broker'
import { extensionFrameConfigSchema } from '@shared/schemas/extension-frame'
import { extensionContributionIdSchema } from '@shared/schemas/extensions'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionFrameConfig } from '@shared/types/extension-frame'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { createRendererExtensionTheme } from './extension-theme-context'

export const EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX = 'allow-scripts'

const extensionFrameReadyMessageSchema = Schema.Struct({
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
  type: Schema.Literal('ready'),
})
const extensionFrameMountedMessageSchema = Schema.Struct({
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
  type: Schema.Literal('mounted'),
})
const extensionFrameErrorMessageSchema = Schema.Struct({
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
  type: Schema.Literal('error', 'cleanup-error'),
  message: Schema.String,
})
const extensionFrameInvokeMessageSchema = Schema.Struct({
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
  type: Schema.Literal('invoke'),
  requestId: Schema.String,
  input: Schema.Unknown,
})
const extensionFrameOpenExternalMessageSchema = Schema.Struct({
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
  type: Schema.Literal('open-external'),
  url: Schema.String,
})
const extensionFrameResizeMessageSchema = Schema.Struct({
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
  type: Schema.Literal('resize'),
  height: Schema.Number,
})
const extensionFrameSurfaceActionMessageSchema = Schema.Struct({
  channel: Schema.Literal(EXTENSION_FRAME_MESSAGE_CHANNEL),
  frameId: Schema.String,
  type: Schema.Literal('surface-action'),
  actionId: Schema.String,
  payload: Schema.optional(jsonValueSchema),
})
const extensionFrameMessageSchema = Schema.Union(
  extensionFrameReadyMessageSchema,
  extensionFrameMountedMessageSchema,
  extensionFrameErrorMessageSchema,
  extensionFrameInvokeMessageSchema,
  extensionFrameOpenExternalMessageSchema,
  extensionFrameResizeMessageSchema,
  extensionFrameSurfaceActionMessageSchema,
)
const extensionMountInvokeInputSchema = Schema.Struct({
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  payload: Schema.optional(Schema.Unknown),
})

export type ExtensionFrameMessage = SchemaType<typeof extensionFrameMessageSchema>
export type ExtensionFrameInvokeMessage = SchemaType<typeof extensionFrameInvokeMessageSchema>

export function extensionFrameConfig(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly moduleUrl: string
  readonly surfacePayload?: JsonValue
}) {
  return {
    moduleUrl: input.moduleUrl,
    context: createOpenWaggleExtensionSurfaceContext({
      entry: input.entry,
      surfacePayload: input.surfacePayload,
      theme: createRendererExtensionTheme(),
    }),
  } satisfies ExtensionFrameConfig
}

export function decodeExtensionFrameMessage(value: unknown, frameId: string) {
  const decoded = safeDecodeUnknown(extensionFrameMessageSchema, value)
  if (!decoded.success || decoded.data.frameId !== frameId) {
    return null
  }
  return decoded.data
}

function invalidInvokeFailure(issues: readonly string[]): ExtensionInvokeResult {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_INPUT,
      message: 'Invalid extension capability invocation.',
      issues,
    },
  }
}

export function extensionInvokeInputFromFrame(
  entry: ExtensionContributionRegistryEntry,
  input: unknown,
): ExtensionInvokeInput | ExtensionInvokeResult {
  const decoded = safeDecodeUnknown(extensionMountInvokeInputSchema, input)
  if (!decoded.success) {
    return invalidInvokeFailure(decoded.issues)
  }

  return {
    ...decoded.data,
    extensionId: entry.extensionId,
    contributionId: entry.contributionId,
  } satisfies ExtensionInvokeInput
}

export function postFrameMessage(
  frameWindow: Pick<Window, 'postMessage'>,
  frameId: string,
  message:
    | { readonly type: 'dispose' }
    | {
        readonly type: 'configure'
        readonly config: ExtensionFrameConfig
      }
    | {
        readonly type: 'invoke-result'
        readonly requestId: string
        readonly result: ExtensionInvokeResult
      },
) {
  if (message.type === 'configure') {
    const decoded = safeDecodeUnknown(extensionFrameConfigSchema, message.config)
    if (!decoded.success) {
      return
    }
  }

  frameWindow.postMessage(
    {
      channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
      frameId,
      ...message,
    },
    '*',
  )
}
