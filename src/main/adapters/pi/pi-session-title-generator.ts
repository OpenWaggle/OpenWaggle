import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import {
  createAgentSessionFromServices,
  type ModelRuntime,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { SESSION_TITLE_MODEL_AUTOMATIC } from '@shared/session-title-model'
import { SupportedModelId } from '@shared/types/brand'
import { createModelRef, parseModelRef } from '@shared/types/llm'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionTitleGenerationError } from '../../errors'
import { createLogger } from '../../logger'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import {
  type SessionTitleGenerationRequest,
  SessionTitleGenerator,
} from '../../ports/session-title-generator'
import type { OpenWagglePiExtensionSelectionServices } from './openwaggle-pi-extension-selection'
import { registerPiBundledBedrockProvider } from './pi-bundled-bedrock'
import { createPiModelRuntime } from './pi-model-runtime'
import { loadWithProjectExtensions } from './pi-project-runtime-load'
import { createPiRuntimeServices } from './pi-provider-catalog'
import { getPiRuntimeExtensionLoadErrors } from './pi-runtime-extension-load-errors'
import { isTitleModelRefusal, TitleModelRefusals } from './pi-title-model-refusals'

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
  const sessionModel =
    findModel(runtime, request.sessionModel) ?? findModel(runtime, request.fallbackModel ?? null)
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

/** The model registry title requests resolve against, and what releases it afterwards. */
interface TitleModelRegistry {
  readonly modelRuntime: ModelRuntime
  readonly release: () => void
}

/** The model registry title requests resolve against for a Session's project. */
type TitleModelRuntime = (projectPath: string | null) => Promise<TitleModelRegistry>

async function generateTitle(
  request: SessionTitleGenerationRequest,
  modelRuntime: TitleModelRuntime,
  refusals: TitleModelRefusals,
) {
  const registry = await modelRuntime(request.projectPath)
  try {
    return await requestFromCandidates(registry.modelRuntime, request, refusals)
  } finally {
    registry.release()
  }
}

/**
 * The candidates a request tries. Background requests skip a model its provider refused a short
 * while ago, unless it is the only one; a person asking for a title tries it again.
 */
function unpausedCandidates(
  candidates: readonly PiModel[],
  request: SessionTitleGenerationRequest,
  refusals: TitleModelRefusals,
) {
  if (request.retryRefusedModels) return candidates
  const unpaused = candidates.filter(
    (model) => !refusals.isPaused(createModelRef(model.provider, model.id)),
  )
  return unpaused.length > 0 ? unpaused : candidates.slice(-1)
}

async function requestFromCandidates(
  runtime: ModelRuntime,
  request: SessionTitleGenerationRequest,
  refusals: TitleModelRefusals,
) {
  const candidates = await candidateModels(runtime, request)
  if (candidates.length === 0) {
    throw new SessionTitleGenerationError({
      reason: 'no-model',
      message: 'No Title model is available for this session.',
    })
  }
  let lastError: unknown
  for (const model of unpausedCandidates(candidates, request, refusals)) {
    const modelRef = createModelRef(model.provider, model.id)
    try {
      const text = await requestTitle(runtime, model, request)
      refusals.clear(modelRef)
      if (text) return { text, modelRef: SupportedModelId(modelRef) }
      lastError = new Error('The Title model returned an empty reply.')
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('Title model request failed', { model: modelRef, error: message })
      if (isTitleModelRefusal(message)) refusals.record(modelRef, message)
    }
  }
  throw new SessionTitleGenerationError({
    reason: 'request-failed',
    message: lastError instanceof Error ? lastError.message : 'The Title model request failed.',
    cause: lastError,
  })
}

/** One per Host, so every Session's background titles skip a model its provider refused. */
const hostTitleModelRefusals = new TitleModelRefusals()

export function createPiSessionTitleGenerator(deps: {
  readonly modelRuntime: TitleModelRuntime
  readonly refusals?: TitleModelRefusals
}) {
  const refusals = deps.refusals ?? hostTitleModelRefusals
  return SessionTitleGenerator.of({
    generate: (request) =>
      Effect.tryPromise({
        try: () => generateTitle(request, deps.modelRuntime, refusals),
        catch: (cause) =>
          cause instanceof SessionTitleGenerationError
            ? cause
            : new SessionTitleGenerationError({
                reason: 'request-failed',
                message: cause instanceof Error ? cause.message : 'The Title model request failed.',
                cause,
              }),
      }),
  })
}

/**
 * The project's own model registry, built like a Run's: Pi's extensions and the OpenWaggle
 * extensions the project runs register their providers, virtual models included, so Automatic
 * and a picked extension Title model resolve and route as the Session's model does.
 */
export function projectTitleModelRuntime(
  extensionSelectionServices: OpenWagglePiExtensionSelectionServices,
): TitleModelRuntime {
  return async (projectPath) => {
    if (!projectPath) {
      registerPiBundledBedrockProvider()
      return { modelRuntime: await createPiModelRuntime(), release: () => undefined }
    }
    const services = await Effect.runPromise(
      loadWithProjectExtensions({
        projectPath,
        extensionSelectionServices,
        operation: 'Pi Title model',
        load: (options) => createPiRuntimeServices(projectPath, options),
        loadErrors: getPiRuntimeExtensionLoadErrors,
      }),
    )
    // A virtual model routes each request with an extension context, which Pi creates only once
    // an agent session binds the extension runner. This session binds it and nothing else: it is
    // never started, so extensions see no session_start, and it is disposed after the request.
    const { session } = await createAgentSessionFromServices({
      services,
      sessionManager: SessionManager.inMemory(projectPath),
    })
    return { modelRuntime: services.modelRuntime, release: () => session.dispose() }
  }
}

export const PiSessionTitleGeneratorLive = Layer.effect(
  SessionTitleGenerator,
  Effect.gen(function* () {
    const extensionSelectionServices = {
      manager: yield* ExtensionManagerService,
      lifecycleRepository: yield* ExtensionLifecycleRepository,
      projectOverridesRepository: yield* ExtensionProjectOverridesRepository,
    } satisfies OpenWagglePiExtensionSelectionServices
    return createPiSessionTitleGenerator({
      modelRuntime: projectTitleModelRuntime(extensionSelectionServices),
    })
  }),
)
