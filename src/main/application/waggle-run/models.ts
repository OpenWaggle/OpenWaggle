import { SupportedModelId } from '@shared/types/brand'
import { parseModelRef } from '@shared/types/llm'
import type { Settings } from '@shared/types/settings'
import type { SessionDetail } from '@shared/types/session'
import { isInheritedWaggleModelBinding, type WaggleConfig } from '@shared/types/waggle'
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
    for (const agent of input.config.agents) {
      if (isInheritedWaggleModelBinding(agent.model)) continue
      const provider = parseModelRef(agent.model.trim())?.provider
      if (provider && restriction && !restriction.right.allows(provider)) {
        return unavailable(
          `${agent.label} uses ${agent.model}, whose provider this project's provider restrictions do not allow. Choose another model for ${agent.label}.`,
        )
      }
      if (yield* known(agent.model)) continue
      return unavailable(
        `${agent.label} uses ${agent.model}, which is not available in this project. Choose another model for ${agent.label}.`,
      )
    }
    return { ok: true as const, inheritedModel }
  })
}
