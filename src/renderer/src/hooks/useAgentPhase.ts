import type { ConversationId } from '@shared/types/brand'
import type { AgentPhaseState } from '@shared/types/phase'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'

export function useAgentPhase(conversationId: ConversationId | null): AgentPhaseState | null {
  const [phase, setPhase] = useState<AgentPhaseState | null>(null)
  const sawEventRef = useRef(false)

  useEffect(() => {
    if (!conversationId) {
      setPhase(null)
      sawEventRef.current = false
      return
    }

    setPhase(null)
    sawEventRef.current = false
    let active = true
    const unsubscribe = api.onAgentPhase((payload) => {
      if (payload.conversationId !== conversationId) return
      sawEventRef.current = true
      setPhase(payload.phase)
    })

    void api
      .getAgentPhase(conversationId)
      .then((snapshot) => {
        if (!active || sawEventRef.current) return
        setPhase(snapshot)
      })
      .catch(() => {
        // No-op: snapshot bootstrap is best-effort; live phase events still drive UI.
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [conversationId])

  return phase
}
