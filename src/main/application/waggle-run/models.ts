import { SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { isInheritedWaggleModelBinding, type WaggleConfig } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import { lastAnsweringModelReference } from '../../domain/session-model-fallback'
import { ProviderService } from '../../ports/provider-service'

export function resolveInitialWaggleRuntimeModel(input: {
  readonly config: WaggleConfig
  readonly selectedModel: SupportedModelId
}): SupportedModelId {
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
 * The model agents that inherit the Session model run on, and a refusal for an agent whose
 * model the project's catalog lacks. Like a classic Run, an inherited model that is gone, such
 * as a virtual model whose extension was removed, continues on the model that answered the
 * Session last. An agent's own model is the user's pick for that agent, so it never falls back.
 */
export function resolveWaggleRunModels(input: {
  readonly config: WaggleConfig
  readonly model: SupportedModelId
  readonly session: Pick<SessionDetail, 'messages' | 'projectPath'>
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
    for (const agent of input.config.agents) {
      if (isInheritedWaggleModelBinding(agent.model) || (yield* known(agent.model))) continue
      return unavailable(
        `${agent.label} uses ${agent.model}, which is not available in this project. Choose another model for ${agent.label}.`,
      )
    }
    return { ok: true as const, inheritedModel }
  })
}
