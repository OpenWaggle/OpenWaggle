import { SupportedModelId } from '@shared/types/brand'
import { isInheritedWaggleModelBinding, type WaggleConfig } from '@shared/types/waggle'

function resolveWaggleRuntimeModel(input: {
  readonly model: WaggleConfig['agents'][number]['model']
  readonly inheritedModel: SupportedModelId
}) {
  return isInheritedWaggleModelBinding(input.model)
    ? input.inheritedModel
    : SupportedModelId(input.model)
}

export function resolveWaggleRuntimeConfig(input: {
  readonly config: WaggleConfig
  readonly inheritedModel: SupportedModelId
}) {
  const [firstAgent, secondAgent] = input.config.agents
  return {
    ...input.config,
    agents: [
      {
        ...firstAgent,
        model: resolveWaggleRuntimeModel({
          model: firstAgent.model,
          inheritedModel: input.inheritedModel,
        }),
      },
      {
        ...secondAgent,
        model: resolveWaggleRuntimeModel({
          model: secondAgent.model,
          inheritedModel: input.inheritedModel,
        }),
      },
    ],
  } satisfies WaggleConfig
}
