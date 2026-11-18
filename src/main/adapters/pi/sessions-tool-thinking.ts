import { THINKING_LEVELS } from '@shared/types/settings'

export function sessionsToolThinkingLevel(value: string | undefined) {
  if (!value) return undefined
  const resolved = THINKING_LEVELS.find((candidate) => candidate === value)
  if (!resolved) throw new Error(`Unsupported thinking level: ${value}.`)
  return resolved
}
