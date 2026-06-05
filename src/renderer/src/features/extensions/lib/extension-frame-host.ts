import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import {
  EXTENSION_FRAME_BOOTSTRAP_SCRIPT,
  EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH,
  EXTENSION_FRAME_MESSAGE_CHANNEL,
} from '@shared/constants/extension-frame'
import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { extensionInvokeScopeSchema } from '@shared/schemas/extension-broker'
import { extensionContributionIdSchema } from '@shared/schemas/extensions'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { OpenWaggleExtensionMountContext } from './extension-federated-module'

export const EXTENSION_FEDERATED_MODULE_IFRAME_SANDBOX = 'allow-scripts'
const EXTENSION_FRAME_ROOT_ID = 'openwaggle-extension-root'
const EXTENSION_FRAME_CSP = [
  ['default-src', ["'none'"]],
  ['script-src', [EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH, 'openwaggle-extension:']],
  ['script-src-elem', [EXTENSION_FRAME_BOOTSTRAP_SCRIPT_HASH, 'openwaggle-extension:']],
  ['style-src', ["'unsafe-inline'"]],
  ['base-uri', ["'none'"]],
  ['form-action', ["'none'"]],
] as const

type ExtensionFrameMountContext = Omit<OpenWaggleExtensionMountContext, 'root' | 'sdk'>

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
const extensionFrameMessageSchema = Schema.Union(
  extensionFrameMountedMessageSchema,
  extensionFrameErrorMessageSchema,
  extensionFrameInvokeMessageSchema,
)
const extensionMountInvokeInputSchema = Schema.Struct({
  capability: extensionContributionIdSchema,
  method: extensionContributionIdSchema,
  scope: extensionInvokeScopeSchema,
  payload: Schema.optional(Schema.Unknown),
})

export type ExtensionFrameMessage = SchemaType<typeof extensionFrameMessageSchema>
export type ExtensionFrameInvokeMessage = SchemaType<typeof extensionFrameInvokeMessageSchema>

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeDoubleQuotedAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function extensionFrameMountContext(entry: ExtensionContributionRegistryEntry) {
  return {
    extension: {
      id: entry.extensionId,
      name: entry.extensionName,
      version: entry.extensionVersion,
    },
    contribution: {
      id: entry.contributionId,
      title: entry.title,
      family: entry.family,
    },
    surface: {
      family: entry.family,
      execution: entry.execution ?? '',
    },
    packagePath: entry.packagePath,
    projectPaths: entry.projectPaths,
    theme: {
      colorScheme: 'dark',
    },
  } satisfies ExtensionFrameMountContext
}

function extensionFrameConfig(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly frameId: string
  readonly moduleUrl: string
}) {
  return JSON.stringify({
    frameId: input.frameId,
    moduleUrl: input.moduleUrl,
    context: extensionFrameMountContext(input.entry),
  })
}

function extensionFrameCsp(entry: ExtensionContributionRegistryEntry) {
  const directives: Array<readonly [string, readonly string[]]> = [...EXTENSION_FRAME_CSP]
  if (entry.networkOrigins !== undefined && entry.networkOrigins.length > 0) {
    directives.push(['connect-src', entry.networkOrigins])
  }

  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
}

export function createExtensionFrameDocument(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly frameId: string
  readonly moduleUrl: string
}) {
  const configJson = extensionFrameConfig(input)

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeDoubleQuotedAttribute(extensionFrameCsp(input.entry))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.entry.title)}</title>
<style>
:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: transparent; color: #e6edf3; }
* { box-sizing: border-box; }
html, body, #${EXTENSION_FRAME_ROOT_ID} { min-height: 100%; }
body { margin: 0; background: transparent; }
#${EXTENSION_FRAME_ROOT_ID} { min-width: 0; }
[role="alert"] { padding: 12px; color: #ff6b6b; font: 12px ui-sans-serif, system-ui, sans-serif; }
</style>
</head>
<body data-openwaggle-config="${escapeHtml(configJson)}">
<div id="${EXTENSION_FRAME_ROOT_ID}"></div>
<script type="module">${EXTENSION_FRAME_BOOTSTRAP_SCRIPT}</script>
</body>
</html>`
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
  frameWindow: Window,
  frameId: string,
  message:
    | { readonly type: 'dispose' }
    | {
        readonly type: 'invoke-result'
        readonly requestId: string
        readonly result: ExtensionInvokeResult
      },
) {
  frameWindow.postMessage(
    {
      channel: EXTENSION_FRAME_MESSAGE_CHANNEL,
      frameId,
      ...message,
    },
    '*',
  )
}
