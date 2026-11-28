import { SupportedModelId } from '@shared/types/brand'
import { parseModelRef } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import type { SessionDetail } from '@shared/types/session'
import { isInheritedWaggleModelBinding, type WaggleConfig } from '@shared/types/waggle'
import type { ResolvedProviderRestriction } from '@shared/utils/provider-restriction'
import * as Effect from 'effect/Effect'
import { lastAnsweringModelReference } from '../../domain/session-model-fallback'
import { ProviderService } from '../../ports/provider-service'
import { loadProjectProviderRestriction } from '../project-provider-restriction'

export function resolveInitialWaggleRuntimeModel(input: {
  readonly config: WaggleConfig
  readonly selectedModel: SupportedModelId
}) {
  const firstAgentModel = input.config.agents[0].model
  return isInheritedWaggleModelBinding(firstAgentModel)
    ? input.selectedModel
    : SupportedModelId(firstAgentModel)
}

export function configRequiresInheritedModel(config: WaggleConfig) {
  return config.agents.some((agent) => isInheritedWaggleModelBinding(agent.model))
}

function unavailable(message: string) {
  return {
    ok: false as const,
    outcome: { outcome: 'validation-error' as const, message, code: 'validation-error' },
  }
}

/**
 * Why the project's provider restrictions refuse this Waggle Run, or null. The Session's model, or
 * the model it falls back to, was a person's choice, so an agent inheriting it from a refused
 * provider fails the Run like a classic Run (ADR 0071); so does an agent's own model.
 */
function waggleProviderRefusal(
  config: WaggleConfig,
  inheritedModel: SupportedModelId,
  restriction: ResolvedProviderRestriction,
) {
  const refused = (model: string) => {
    const provider = parseModelRef(model.trim())?.provider
    return provider !== undefined && !restriction.allows(provider) ? provider : null
  }
  const inheritedProvider = configRequiresInheritedModel(config) ? refused(inheritedModel) : null
  if (inheritedProvider !== null) {
    return `This Session's model ${JSON.stringify(inheritedModel)} uses provider ${JSON.stringify(inheritedProvider)}, which this project's provider restrictions do not allow. Pick a model from an allowed provider before starting Waggle mode.`
  }
  for (const agent of config.agents) {
    if (isInheritedWaggleModelBinding(agent.model) || refused(agent.model) === null) continue
    return `${agent.label} uses ${agent.model}, whose provider this project's provider restrictions do not allow. Choose another model for ${agent.label}.`
  }
  return null
}

/**
 * The model agents that inherit the Session model run on, and a refusal for an agent whose
 * model the project's catalog lacks. Like a classic Run, an inherited model that is gone, such
 * as a virtual model whose extension was removed, continues on the model that answered the
 * Session last. An agent's own model is the user's pick for that agent, so it never falls back,
 * and a provider the project's restrictions refuse fails the Run like any named model.
 */
export function resolveWaggleRunModels(input: {
  readonly config: WaggleConfig
  readonly model: SupportedModelId
  readonly session: Pick<SessionDetail, 'messages' | 'projectPath'>
  readonly settings: Settings
}) {
  return Effect.gen(function* () {
    const providerService = yield* ProviderService
    const known = (model: string) => providerService.isKnownModel(model, input.session.projectPath)
    let inheritedModel = input.model
    if (configRequiresInheritedModel(input.config) && !(yield* known(input.model))) {
      const fallback = lastAnsweringModelReference(input.session)
      if (!fallback || !(yield* known(fallback))) {
        return unavailable(
          `The model ${input.model} is not available in this project. Select another model before starting Waggle mode.`,
        )
      }
      inheritedModel = SupportedModelId(fallback)
    }
    const restriction = input.session.projectPath
      ? yield* loadProjectProviderRestriction(input.settings, input.session.projectPath).pipe(
          Effect.either,
        )
      : undefined
    if (restriction?._tag === 'Left') return unavailable(restriction.left.message)
    const refusal = restriction
      ? waggleProviderRefusal(input.config, inheritedModel, restriction.right)
      : null
    if (refusal !== null) return unavailable(refusal)
    for (const agent of input.config.agents) {
      if (isInheritedWaggleModelBinding(agent.model)) continue
      if (yield* known(agent.model)) continue
      return unavailable(
        `${agent.label} uses ${agent.model}, which is not available in this project. Choose another model for ${agent.label}.`,
      )
    }
    return { ok: true as const, inheritedModel }
  })
}
