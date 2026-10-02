import type { ThinkingLevel } from '@shared/types/settings'
import { Context, type Effect } from 'effect'

/**
 * Pi's global default thinking level: where a new Session's thinking level starts. A Session's
 * own thinking level is Session state; changing it as the desktop user also makes it this default
 * (Pi's `setThinkingLevel(level, { persist: true })`), without changing any existing Session.
 */
export interface ThinkingLevelDefaultServiceShape {
  /** Pi's default for new Sessions, as Pi resolves it for `projectPath` (project over global). */
  readonly getDefault: (projectPath?: string | null) => Effect.Effect<ThinkingLevel, Error>
  /** Persists Pi's global default. */
  readonly setDefault: (level: ThinkingLevel) => Effect.Effect<void, Error>
}

export class ThinkingLevelDefaultService extends Context.Tag(
  '@openwaggle/ThinkingLevelDefaultService',
)<ThinkingLevelDefaultService, ThinkingLevelDefaultServiceShape>() {}
