import type { SessionId } from '@shared/types/brand'
import { useState } from 'react'
import type { PendingSend } from '../model'

/**
 * The composer send the transcript is waiting to hold near the top (ADR 0036).
 *
 * A pending send belongs to the Session it was made in; only a draft's first send carries into
 * the Session it creates. One left pending by a send that never produced a message must not hold
 * another Session's latest message when its transcript opens.
 */
export function usePendingSend(activeSessionId: SessionId | null) {
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null)
  const [sessionId, setSessionId] = useState(activeSessionId)
  if (sessionId !== activeSessionId) {
    setSessionId(activeSessionId)
    if (sessionId !== null) setPendingSend(null)
  }
  return [pendingSend, setPendingSend] as const
}
