import type { ThinkingLevel } from '@shared/types/settings'
import { THINKING_LEVEL_LABELS } from '../constants'

interface ThinkingLevelTitleInput {
  readonly hasSelectedModel: boolean
  readonly capabilitiesKnown: boolean
  readonly selectedModelOnlySupportsOff: boolean
  readonly isAdjustedForModel: boolean
  readonly requestedThinkingLevel: ThinkingLevel
  readonly effectiveThinkingLevel: ThinkingLevel
}

export function hasOnlyOffThinkingLevel(levels: readonly ThinkingLevel[]) {
  return levels.length === 1 && levels[0] === 'off'
}

export function getThinkingButtonLabel(
  hasSelectedModel: boolean,
  capabilitiesKnown: boolean,
  effectiveThinkingLevel: ThinkingLevel,
) {
  return hasSelectedModel && capabilitiesKnown
    ? THINKING_LEVEL_LABELS[effectiveThinkingLevel]
    : 'Thinking…'
}

export function getThinkingButtonTitle({
  hasSelectedModel,
  capabilitiesKnown,
  selectedModelOnlySupportsOff,
  isAdjustedForModel,
  requestedThinkingLevel,
  effectiveThinkingLevel,
}: ThinkingLevelTitleInput) {
  if (!hasSelectedModel) return 'Select a model before choosing thinking level'
  if (!capabilitiesKnown) return 'Loading thinking capabilities for the selected model'
  if (selectedModelOnlySupportsOff) return 'Selected model does not support thinking'
  if (isAdjustedForModel) {
    return `${THINKING_LEVEL_LABELS[requestedThinkingLevel]} is not available for this model; using ${THINKING_LEVEL_LABELS[effectiveThinkingLevel]}`
  }
  return 'Select thinking level'
}
