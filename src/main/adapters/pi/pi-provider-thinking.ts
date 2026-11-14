import { type Api, getSupportedThinkingLevels, type Model } from '@earendil-works/pi-ai'

export function getPiModelAvailableThinkingLevels<TApi extends Api>(model: Model<TApi>) {
  return getSupportedThinkingLevels(model)
}
