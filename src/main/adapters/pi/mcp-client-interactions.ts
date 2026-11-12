import { complete } from '@earendil-works/pi-ai/compat'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { openExternal } from '../../desktop-ui'
import { getOpenWaggleAuthorize } from './agent-kernel/openwaggle-authorize-channel'
import type {
  McpElicitationResult,
  McpRuntimeInteractions,
  McpSamplingResult,
} from './mcp/mcp-interaction-types'
import { parseElicitationContent } from './mcp-elicitation-content'
import {
  declaredConfirm,
  interactionSignal,
  isLoopback,
  isObject,
  type JsonObject,
  mcpRequestFields,
  numberValue,
  requireUi,
  reviewText,
  stringValue,
} from './mcp-interaction-helpers'
import {
  samplingContent,
  samplingContext,
  samplingStreamOptions,
  stopReason,
  toSamplingTools,
} from './mcp-sampling-request'

const MAX_SAMPLING_TOKENS = 16_384

async function handleUrlElicitation(input: {
  readonly ctx: ExtensionContext
  readonly serverLabel: string
  readonly request: JsonObject
  readonly signal?: AbortSignal | undefined
}): Promise<McpElicitationResult> {
  const urlText = stringValue(mcpRequestFields(input.request).url)
  if (!urlText) throw new Error('MCP URL elicitation did not include a URL.')
  const url = new URL(urlText)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
    throw new Error('MCP URL elicitation requires HTTPS except on loopback.')
  }
  const signal = interactionSignal(input.ctx, input.signal)
  const approved = await declaredConfirm({
    ctx: input.ctx,
    // The consequence is a page at a destination a third party chose, which is the user's to accept.
    purpose: 'external-navigation',
    title: 'Open MCP elicitation URL?',
    message: [
      `Server: ${input.serverLabel}`,
      `Message: ${stringValue(mcpRequestFields(input.request).message) ?? 'No message provided'}`,
      `Destination: ${url.origin}`,
      '',
      'The page may request sensitive information. OpenWaggle will not read the page or its values.',
    ].join('\n'),
    signal,
  })
  if (!approved) return { action: 'decline' }
  await openExternal(url.href)
  const completed = await input.ctx.ui.confirm(
    'MCP elicitation opened',
    'Confirm only after you have completed the external flow. The server will be told that the flow may continue.',
    signal ? { signal } : {},
  )
  return { action: completed ? 'accept' : 'cancel' }
}

async function handleFormElicitation(input: {
  readonly ctx: ExtensionContext
  readonly serverLabel: string
  readonly request: JsonObject
  readonly signal?: AbortSignal | undefined
}): Promise<McpElicitationResult> {
  const signal = interactionSignal(input.ctx, input.signal)
  const approved = await declaredConfirm({
    ctx: input.ctx,
    // Names which server wants the user's data and shows the schema being asked for. Auto-answering
    // saves no work, because the editor that follows still blocks; it only removes the explanation.
    purpose: 'disclosure',
    title: 'Review MCP input request?',
    message: [
      `Server: ${input.serverLabel}`,
      `Message: ${stringValue(mcpRequestFields(input.request).message) ?? 'No message provided'}`,
      '',
      'Requested form schema:',
      reviewText(mcpRequestFields(input.request).requestedSchema ?? null),
      '',
      'This consent applies only to this request. Your response is sent to the named server.',
    ].join('\n'),
    signal,
  })
  if (!approved) return { action: 'decline' }
  const edited = await input.ctx.ui.editor(`MCP input for ${input.serverLabel}`, '{}')
  if (edited === undefined) return { action: 'cancel' }
  return { action: 'accept', content: parseElicitationContent(edited) }
}

/**
 * Asks permission for a legacy sampling request.
 *
 * Declared as authorization and keyed on the server and the capability alone: the model is chosen by
 * OpenWaggle rather than the server, so keying on it would only invalidate a kept approval whenever
 * the user changes model, which is noise rather than safety.
 */
async function askSamplingApproval(input: {
  readonly ctx: ExtensionContext
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly request: JsonObject
  readonly maxTokens: number
  readonly toolCount: number
  readonly modelRef: string
  readonly signal?: AbortSignal | undefined
}) {
  const title = 'Allow legacy MCP sampling?'
  const message = [
    `Server: ${input.serverLabel}`,
    `Model chosen by OpenWaggle: ${input.modelRef}`,
    `Maximum output tokens: ${String(input.maxTokens)}`,
    `Server-provided tools: ${String(input.toolCount)}`,
    'Task history and ambient OpenWaggle tools will not be shared.',
    '',
    reviewText(input.request),
  ].join('\n')

  const authorize = getOpenWaggleAuthorize(input.ctx.ui)
  if (authorize) {
    return authorize({
      title,
      message,
      scopeKey: {
        // Identity is the stable instance id; the label is display only, so a rename cannot move a
        // grant and a reused name cannot inherit one.
        requesterId: input.serverInstanceId,
        requester: input.serverLabel,
        capability: 'mcp.sampling',
      },
      ...(input.signal ? { signal: input.signal } : {}),
    })
  }

  // No OpenWaggle channel, so degrade to always asking rather than to always allowing.
  return input.ctx.ui.confirm(
    title,
    `${message}\n\nThis approval applies only to this sampling request.`,
    input.signal ? { signal: input.signal } : {},
  )
}

async function handleSampling(input: {
  readonly ctx: ExtensionContext
  readonly serverInstanceId: string
  readonly serverLabel: string
  readonly request: JsonObject
  readonly signal?: AbortSignal | undefined
}): Promise<McpSamplingResult> {
  requireUi(input.ctx, 'legacy sampling')
  if (!input.ctx.model) throw new Error('MCP sampling requires a selected model.')
  const signal = interactionSignal(input.ctx, input.signal)
  const requestedTokens =
    numberValue(mcpRequestFields(input.request).maxTokens) ?? MAX_SAMPLING_TOKENS
  const maxTokens = Math.max(
    1,
    Math.min(requestedTokens, input.ctx.model.maxTokens, MAX_SAMPLING_TOKENS),
  )
  const tools = toSamplingTools(input.request)
  const approved = await askSamplingApproval({
    ctx: input.ctx,
    serverInstanceId: input.serverInstanceId,
    serverLabel: input.serverLabel,
    request: input.request,
    maxTokens,
    toolCount: tools?.length ?? 0,
    modelRef: `${input.ctx.model.provider}/${input.ctx.model.id}`,
    signal,
  })
  if (!approved) throw new Error('The user declined the MCP sampling request.')
  const model = input.ctx.modelRegistry.find(input.ctx.model.provider, input.ctx.model.id)
  if (!model) throw new Error('The selected MCP sampling model is no longer available.')
  const auth = await input.ctx.modelRegistry.getApiKeyAndHeaders(model)
  if (!auth.ok) throw new Error(auth.error)
  const response = await complete(
    model,
    samplingContext(input.request),
    samplingStreamOptions(
      auth,
      signal,
      maxTokens,
      numberValue(mcpRequestFields(input.request).temperature),
    ),
  )
  if (response.stopReason === 'error' || response.stopReason === 'aborted') {
    throw new Error(response.errorMessage ?? `MCP sampling ${response.stopReason}.`)
  }
  return {
    model: `${model.provider}/${model.id}`,
    role: 'assistant',
    content: samplingContent(response, Boolean(tools)),
    stopReason: stopReason(response.stopReason),
  }
}

export function createPiMcpRuntimeInteractions(ctx: ExtensionContext): McpRuntimeInteractions {
  return {
    elicit: async (input) => {
      requireUi(ctx, 'elicitation')
      if (!isObject(input.request)) throw new Error('Invalid MCP elicitation request.')
      return mcpRequestFields(input.request).mode === 'url'
        ? handleUrlElicitation({
            ctx,
            serverLabel: input.serverLabel,
            request: input.request,
            signal: input.signal,
          })
        : handleFormElicitation({
            ctx,
            serverLabel: input.serverLabel,
            request: input.request,
            signal: input.signal,
          })
    },
    sample: async (input) => {
      if (!isObject(input.request)) throw new Error('Invalid MCP sampling request.')
      return handleSampling({
        ctx,
        serverInstanceId: input.serverInstanceId,
        serverLabel: input.serverLabel,
        request: input.request,
        signal: input.signal,
      })
    },
  }
}
