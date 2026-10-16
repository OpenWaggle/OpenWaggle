import {
  isPiSessionContinuationChoice,
  type PiSessionContinuationChoice,
} from '@shared/pi-session-continuation'
import type { Settings } from '@shared/types/settings'
import { SETTINGS_KEY_PI_SESSION_CONTINUATION_BY_PROJECT } from './keys'
import type { SettingsPatchWrite } from './persistence-plan'

/** The remembered Pi continuation choices; anything else, such as a hand edit, is dropped. */
export function sanitizePiSessionContinuationByProject(raw: unknown) {
  const result: Record<string, PiSessionContinuationChoice> = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result
  for (const [rawProjectPath, value] of Object.entries(raw)) {
    const projectPath = rawProjectPath.trim()
    if (projectPath && isPiSessionContinuationChoice(value)) result[projectPath] = value
  }
  return result
}

export function resolveStoredPiSessionContinuationSettings(
  storedSettings: Readonly<Record<string, unknown>>,
) {
  return {
    piSessionContinuationByProject: sanitizePiSessionContinuationByProject(
      Object.hasOwn(storedSettings, SETTINGS_KEY_PI_SESSION_CONTINUATION_BY_PROJECT)
        ? storedSettings[SETTINGS_KEY_PI_SESSION_CONTINUATION_BY_PROJECT]
        : undefined,
    ),
  }
}

export function resolveNextPiSessionContinuationSettings(
  current: Settings,
  partial: Partial<Settings>,
) {
  return {
    piSessionContinuationByProject:
      partial.piSessionContinuationByProject === undefined
        ? current.piSessionContinuationByProject
        : sanitizePiSessionContinuationByProject(partial.piSessionContinuationByProject),
  }
}

export function appendPiSessionContinuationSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  if (partial.piSessionContinuationByProject === undefined) return
  writes.push({
    key: SETTINGS_KEY_PI_SESSION_CONTINUATION_BY_PROJECT,
    value: next.piSessionContinuationByProject,
  })
}
