import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { ThinkingLevelDefaultService } from '../../ports/thinking-level-default-service'
import { createOpenWaggleGlobalPiSettingsManager } from './openwaggle-pi-settings-storage'

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function knownThinkingLevel(value: string | undefined): ThinkingLevel {
  return THINKING_LEVELS.find((level) => level === value) ?? DEFAULT_THINKING_LEVEL
}

/**
 * Pi's global `defaultThinkingLevel`, falling back to Pi's built-in default when it names none.
 * Project settings are never read: OpenWaggle has no project-level default thinking level.
 */
export function readPiDefaultThinkingLevel(): ThinkingLevel {
  return knownThinkingLevel(createOpenWaggleGlobalPiSettingsManager().getDefaultThinkingLevel())
}

/** Persists Pi's global default the way Pi's `setThinkingLevel(level, { persist: true })` does. */
export async function writePiDefaultThinkingLevel(level: ThinkingLevel) {
  const settingsManager = createOpenWaggleGlobalPiSettingsManager()
  settingsManager.setDefaultThinkingLevel(level)
  await settingsManager.flush()
}

export const PiThinkingLevelDefaultLive = Layer.succeed(ThinkingLevelDefaultService, {
  getDefault: () => Effect.try({ try: () => readPiDefaultThinkingLevel(), catch: toError }),
  setDefault: (level) =>
    Effect.tryPromise({ try: () => writePiDefaultThinkingLevel(level), catch: toError }),
})
