import type { PiCacheWarmingMode } from '@shared/types/settings'

/**
 * Keeps a Session's provider prompt cache warm between Runs (`cacheWarming: idle`). The Host tells
 * it which mode the user chose and which Sessions were archived, deleted, or unarchived, and starts
 * and stops it with the Host's own services.
 */
export interface PromptCacheWarming {
  /** Any mode but `idle` ends every warming session, and later Runs do not start one. */
  readonly applyMode: (mode: PiCacheWarmingMode) => void
  /** An archived or deleted Session warms nothing, including after a Run still ending. */
  readonly closeSession: (sessionId: string) => void
  readonly reopenSession: (sessionId: string) => void
  /** A deleted Session never runs again, so it need not stay closed. */
  readonly forgetSession: (sessionId: string) => void
  readonly start: () => void
  /** Ends every warming session; a Run ending afterwards keeps nothing until `start`. */
  readonly stop: () => Promise<void>
}
