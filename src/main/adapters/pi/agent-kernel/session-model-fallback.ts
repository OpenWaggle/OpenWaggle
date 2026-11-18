import type { SessionDetail } from '@shared/types/session'
import { lastAnsweringModelReference } from '../../../domain/session-model-fallback'

/** The Pi runtime option that lets a Session whose model is gone run on its last answering one. */
export function sessionFallbackModelReference(session: SessionDetail) {
  const fallbackModelReference = lastAnsweringModelReference(session)
  return fallbackModelReference ? { fallbackModelReference } : {}
}
