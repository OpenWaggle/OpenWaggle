import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { SESSION_TITLE_MODEL_AUTOMATIC } from '@shared/session-title-model'
import { SupportedModelId } from '@shared/types/brand'
import { createModelRef, parseModelRef } from '@shared/types/llm'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionTitleGenerationError } from '../../errors'
import { createLogger } from '../../logger'
import {
  type SessionTitleGenerationRequest,
  SessionTitleGenerator,
} from '../../ports/session-title-generator'
import { registerPiBundledBedrockProvider } from './pi-bundled-bedrock'

const logger = createLogger('pi-session-title-generator')

/** A JSON title fits in far fewer tokens; the headroom covers models that think before answering. */
const TITLE_MAX_OUTPUT_TOKENS = 400
const TITLE_REQUEST_TIMEOUT_MS = 30_000

type PiModel = Model<Api>

function price(model: PiModel) {
  return model.cost.input + model.cost.output
}

function supportsText(model: PiModel) {
  return model.input.includes('text')
}

/**
 * Aggregating providers (Bedrock, OpenRouter) list many vendors' models under one provider, and
 * the cheapest of those can be a speech model or a 3B model. A candidate must share the Session
 * model's vendor line: everything up to the last `/` (`anthropic/claude-…`), or a Bedrock-style
 * `region.vendor.` prefix (`eu.anthropic.claude-…`), which also keeps the request in the same
 * inference region. Ids without such a prefix (`claude-sonnet-4-6`, `gpt-5.5`) share the provider.
 */
const BEDROCK_STYLE_VENDOR = /^((?:[a-z]{2,7}\.)?[a-z]+\.)[a-z]/
/** OpenRouter routing variants such as `:batch` or `:free` change latency or limits, not the model. */
const ROUTING_VARIANT = /:[a-z]+$/

export function modelVendorLine(modelId: string) {
  const slash = modelId.lastIndexOf('/')
  if (slash >= 0) return modelId.slice(0, slash + 1)
  return BEDROCK_STYLE_VENDOR.exec(modelId)?.[1] ?? ''
}

/**
 * The cheapest available text model from the Session model's own provider and vendor line, so
 * the request goes where the Session already sends its messages, under the same login. A model
 * priced at zero (subscriptions, local servers) is already as cheap as it gets and is kept.
 * Non-reasoning models are preferred because thinking only adds latency to a six-word answer.
 */
export function selectAutomaticTitleModel(
  sessionModel: PiModel,
  available: readonly PiModel[],
): PiModel {
  const sessionPrice = price(sessionModel)
  if (sessionPrice <= 0) return sessionModel
  const vendorLine = modelVendorLine(sessionModel.id)
  const cheaper = available.filter(
    (model) =>
      model.provider === sessionModel.provider &&
      modelVendorLine(model.id) === vendorLine &&
      !ROUTING_VARIANT.test(model.id) &&
      supportsText(model) &&
      price(model) > 0 &&
      price(model) < sessionPrice,
  )
  const ranked = [...cheaper].sort(
    (left, right) =>
      Number(left.reasoning) - Number(right.reasoning) ||
      price(left) - price(right) ||
      left.id.localeCompare(right.id),
  )
  return ranked[0] ?? sessionModel
}

function findModel(runtime: ModelRuntime, reference: string | null) {
  const parsed = reference ? parseModelRef(reference) : null
  return parsed ? (runtime.getModel(parsed.provider, parsed.modelId) ?? null) : null
}

async function candidateModels(runtime: ModelRuntime, request: SessionTitleGenerationRequest) {
  const sessionModel = findModel(runtime, request.sessionModel)
  const preferred =
    request.titleModel === SESSION_TITLE_MODEL_AUTOMATIC
      ? sessionModel
        ? selectAutomaticTitleModel(sessionModel, await runtime.getAvailable(sessionModel.provider))
        : null
      : findModel(runtime, request.titleModel)
  const candidates = [preferred, sessionModel].filter((model) => model !== null)
  return candidates.filter(
    (model, index) =>
      candidates.findIndex(
        (other) => other.provider === model.provider && other.id === model.id,
      ) === index,
  )
}

function responseText(message: AssistantMessage) {
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
    .trim()
}

async function requestTitle(
  runtime: ModelRuntime,
  model: PiModel,
  request: SessionTitleGenerationRequest,
) {
  const response = await runtime.completeSimple(
    model,
    {
      systemPrompt: request.systemPrompt,
      messages: [{ role: 'user', content: request.prompt, timestamp: Date.now() }],
    },
    {
      maxTokens: Math.min(TITLE_MAX_OUTPUT_TOKENS, model.maxTokens),
      signal: AbortSignal.timeout(TITLE_REQUEST_TIMEOUT_MS),
    },
  )
  if (response.stopReason === 'error' || response.stopReason === 'aborted') {
    throw new Error(response.errorMessage ?? `Title request ${response.stopReason}.`)
  }
  return responseText(response)
}

async function generateTitle(request: SessionTitleGenerationRequest) {
  registerPiBundledBedrockProvider()
  const runtime = await ModelRuntime.create()
  const candidates = await candidateModels(runtime, request)
  if (candidates.length === 0) {
    throw new SessionTitleGenerationError({
      reason: 'no-model',
      message: 'No Title model is available for this session.',
    })
  }
  let lastError: unknown
  for (const model of candidates) {
    try {
      const text = await requestTitle(runtime, model, request)
      if (text)
        return { text, modelRef: SupportedModelId(createModelRef(model.provider, model.id)) }
      lastError = new Error('The Title model returned an empty reply.')
    } catch (error) {
      lastError = error
      logger.warn('Title model request failed', {
        model: createModelRef(model.provider, model.id),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  throw new SessionTitleGenerationError({
    reason: 'request-failed',
    message: lastError instanceof Error ? lastError.message : 'The Title model request failed.',
    cause: lastError,
  })
}

export const PiSessionTitleGeneratorLive = Layer.succeed(
  SessionTitleGenerator,
  SessionTitleGenerator.of({
    generate: (request) =>
      Effect.tryPromise({
        try: () => generateTitle(request),
        catch: (cause) =>
          cause instanceof SessionTitleGenerationError
            ? cause
            : new SessionTitleGenerationError({
                reason: 'request-failed',
                message: cause instanceof Error ? cause.message : 'The Title model request failed.',
                cause,
              }),
      }),
  }),
)
