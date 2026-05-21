import { THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'

const PI_THINKING_LEVELS_WITHOUT_XHIGH: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
]
const PI_OFF_THINKING_LEVELS: readonly ThinkingLevel[] = ['off']

function piModelSupportsXhighThinking(modelId: string) {
  return (
    modelId.includes('gpt-5.2') ||
    modelId.includes('gpt-5.3') ||
    modelId.includes('gpt-5.4') ||
    modelId.includes('gpt-5.5') ||
    modelId.includes('opus-4-6') ||
    modelId.includes('opus-4.6') ||
    modelId.includes('opus-4-7') ||
    modelId.includes('opus-4.7')
  )
}

export function getPiModelAvailableThinkingLevels(model: {
  readonly id: string
  readonly reasoning: boolean
}): readonly ThinkingLevel[] {
  if (!model.reasoning) {
    return PI_OFF_THINKING_LEVELS
  }

  return piModelSupportsXhighThinking(model.id) ? THINKING_LEVELS : PI_THINKING_LEVELS_WITHOUT_XHIGH
}
