import type { SessionId } from '@shared/types/brand'
import type { SendFailureDisposition } from '@/features/composer/hooks'
import { useComposerStore } from '@/features/composer/state'
import {
  PiSessionContinuationHeld,
  piSessionContinuationHeldNotice,
} from '../lib/pi-session-continuation'
import { sessionImageSendFailureDisposition } from '../lib/session-image-send-failure'
import { useChatStore } from '../state'
import { useBackgroundRunStore } from '../state/background-run-store'

/** What a failed send leaves in the composer: its text back, unless it reached the agent. */
export function composerSendFailureDisposition(
  cause: unknown,
  activeSessionId: SessionId | null,
): SendFailureDisposition {
  if (cause instanceof PiSessionContinuationHeld) {
    return { kind: 'restore', notice: piSessionContinuationHeldNotice(cause) }
  }
  return sessionImageSendFailureDisposition({
    cause,
    activeSessionId,
    activeDraftContextKey: useComposerStore.getState().activeDraftContextKey,
    savedDraftContextKeys: Object.keys(useComposerStore.getState().scopedDrafts),
    disposedSessions: useChatStore.getState().missingSessionIds,
    hasWorktreeLaunch: (sessionId) =>
      useBackgroundRunStore.getState().getWorktreeLaunch(sessionId) !== null,
  })
}
