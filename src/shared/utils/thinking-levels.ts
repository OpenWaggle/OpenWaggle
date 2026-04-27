import { THINKING_LEVELS, type ThinkingLevel } from '../types/settings'

const FALLBACK_THINKING_LEVEL: ThinkingLevel = 'off'

/**
 * Clamp a requested Pi thinking level to the levels available for the selected model.
 * Mirrors Pi AgentSession's capability-aware ordering: prefer the requested level,
 * then the next higher available level, then the nearest lower available level.
 */
export function clampThinkingLevel(
  requestedLevel: ThinkingLevel,
  availableLevels: readonly ThinkingLevel[],
): ThinkingLevel {
  if (availableLevels.includes(requestedLevel)) {
    return requestedLevel
  }

  const requestedIndex = THINKING_LEVELS.indexOf(requestedLevel)
  for (let index = requestedIndex; index < THINKING_LEVELS.length; index += 1) {
    const candidate = THINKING_LEVELS[index]
    if (candidate && availableLevels.includes(candidate)) {
      return candidate
    }
  }

  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVELS[index]
    if (candidate && availableLevels.includes(candidate)) {
      return candidate
    }
  }

  return availableLevels[0] ?? FALLBACK_THINKING_LEVEL
}
