import { isSessionTitleGenerationEnabled } from '@shared/session-title-model'
import type { SessionId } from '@shared/types/brand'
import { usePreferencesStore } from '@/features/settings/state'
import { regenerateSessionTitle } from '../lib/session-title-commands'
import { useSessionTitleRegenerationStore } from '../state/session-title-regeneration-store'

/** Whether Title regeneration is offered for a Session, and whether one is already running. */
export function useSessionTitleRegeneration(sessionId: SessionId) {
  const enabled = usePreferencesStore((state) =>
    isSessionTitleGenerationEnabled(state.settings.sessionTitleModel),
  )
  const isRegenerating = useSessionTitleRegenerationStore((state) => state.pending.has(sessionId))

  return {
    available: enabled,
    isRegenerating,
    regenerate: () => {
      void regenerateSessionTitle(sessionId)
    },
  }
}
