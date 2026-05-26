import {
  BUILT_IN_WAGGLE_PRESETS as CORE_BUILT_IN_WAGGLE_PRESETS,
  type WagglePreset as CoreWagglePreset,
} from '@openwaggle/waggle-core'
import { WagglePresetId } from '@shared/types/brand'
import { createWaggleModelBinding, type WagglePreset } from '@shared/types/waggle'

function toOpenWaggleAgentModel(model: string): WagglePreset['config']['agents'][number]['model'] {
  return createWaggleModelBinding(model)
}

function toOpenWagglePreset(preset: CoreWagglePreset) {
  const [firstAgent, secondAgent] = preset.config.agents
  const agents: WagglePreset['config']['agents'] = [
    { ...firstAgent, model: toOpenWaggleAgentModel(firstAgent.model) },
    { ...secondAgent, model: toOpenWaggleAgentModel(secondAgent.model) },
  ]

  return {
    ...preset,
    id: WagglePresetId(preset.id),
    config: {
      ...preset.config,
      agents,
    },
  }
}

export const BUILT_IN_WAGGLE_PRESETS: readonly WagglePreset[] =
  CORE_BUILT_IN_WAGGLE_PRESETS.map(toOpenWagglePreset)
