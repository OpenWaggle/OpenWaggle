import type { Settings } from '@shared/types/settings'
import { SETTINGS_KEY_THINKING_LEVEL } from './keys'
import type { SettingsPatchWrite } from './persistence-plan'
import { isValidThinkingLevel } from './sanitizers'

export function appendThinkingLevelWrite(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  if (partial.thinkingLevel === undefined || !isValidThinkingLevel(partial.thinkingLevel)) return
  writes.push({ key: SETTINGS_KEY_THINKING_LEVEL, value: next.thinkingLevel })
}

export function getInvalidThinkingLevel(partial: Partial<Settings>) {
  if (partial.thinkingLevel === undefined || isValidThinkingLevel(partial.thinkingLevel)) {
    return undefined
  }
  return partial.thinkingLevel
}
