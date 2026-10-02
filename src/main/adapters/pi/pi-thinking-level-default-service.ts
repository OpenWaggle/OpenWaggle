import { DEFAULT_THINKING_LEVEL, THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { ThinkingLevelDefaultService } from '../../ports/thinking-level-default-service'
import {
  createOpenWaggleGlobalPiSettingsManager,
  createOpenWagglePiSettingsManager,
} from './openwaggle-pi-settings-storage'

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}

function knownThinkingLevel(value: string | undefined): ThinkingLevel {
  return THINKING_LEVELS.find((level) => level === value) ?? DEFAULT_THINKING_LEVEL
}

/** Pi's `defaultThinkingLevel`, falling back to Pi's built-in default when no setting names one. */
export function readPiDefaultThinkingLevel(projectPath?: string | null): ThinkingLevel {
  const settingsManager = projectPath
    ? createOpenWagglePiSettingsManager(projectPath)
    : createOpenWaggleGlobalPiSettingsManager()
  return knownThinkingLevel(settingsManager.getDefaultThinkingLevel())
}

/** Persists Pi's global default the way Pi's `setThinkingLevel(level, { persist: true })` does. */
export async function writePiDefaultThinkingLevel(level: ThinkingLevel) {
  const settingsManager = createOpenWaggleGlobalPiSettingsManager()
  settingsManager.setDefaultThinkingLevel(level)
  await settingsManager.flush()
}

export const PiThinkingLevelDefaultLive = Layer.succeed(ThinkingLevelDefaultService, {
  getDefault: (projectPath) =>
    Effect.try({ try: () => readPiDefaultThinkingLevel(projectPath), catch: toError }),
  setDefault: (level) =>
    Effect.tryPromise({ try: () => writePiDefaultThinkingLevel(level), catch: toError }),
})
