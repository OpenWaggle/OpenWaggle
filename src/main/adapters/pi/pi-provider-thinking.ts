import { type Api, getSupportedThinkingLevels, type Model } from '@earendil-works/pi-ai'
import type { ThinkingLevel } from '@shared/types/settings'

export function getPiModelAvailableThinkingLevels<TApi extends Api>(
  model: Model<TApi>,
): readonly ThinkingLevel[] {
  return getSupportedThinkingLevels(model)
}
