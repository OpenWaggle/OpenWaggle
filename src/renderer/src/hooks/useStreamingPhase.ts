import { TIME_UNIT } from '@shared/constants/time'
import type { ConversationId } from '@shared/types/brand'
import type { AgentPhaseState } from '@shared/types/phase'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/ipc'

const DELAY_MS = 1000

export interface StreamingPhase {
  label: string
  elapsedMs: number
}

export interface CompletedPhase {
  label: string
  durationMs: number
}

export interface StreamingPhaseState {
  current: StreamingPhase | null
  completed: readonly CompletedPhase[]
  totalElapsedMs: number
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / TIME_UNIT.MILLISECONDS_PER_SECOND)
  if (totalSeconds < TIME_UNIT.SECONDS_PER_MINUTE) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / TIME_UNIT.SECONDS_PER_MINUTE)
  const seconds = totalSeconds % TIME_UNIT.SECONDS_PER_MINUTE
  return `${minutes}m ${seconds}s`
}

export interface StreamingPhaseHandle extends StreamingPhaseState {
  /** Call synchronously before starting a new user interaction (IPC send).
   *  Must be invoked in the same sync block as the send so the reset flag
   *  is visible to the IPC phase handler before any events arrive. */
  reset: () => void
}

/**
 * Tracks agent phase transitions and accumulates completed phase durations.
 *
 * Uses client-side wall-clock timestamps so that setup time, IPC overhead,
 * and gaps between continuation runs are fully captured. The server-provided
 * `startedAt` is only used to detect same-phase dedup; all duration math
 * uses `Date.now()` on the client.
 *
 * Between-run gaps (approval processing, IPC reconnect, server setup) are
 * attributed to the first phase of the next run (typically "Thinking"),
 * giving an accurate picture of where time was spent from the user's
 * perspective.
 */
export function useStreamingPhase(conversationId: ConversationId | null): StreamingPhaseHandle {
  const [currentLabel, setCurrentLabel] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [completedSnapshot, setCompletedSnapshot] = useState<readonly CompletedPhase[]>([])
  const [totalSnapshot, setTotalSnapshot] = useState(0)

  // --- Refs for IPC callback (outside React render) ---
  const phaseRef = useRef<AgentPhaseState | null>(null)
  const completedRef = useRef<CompletedPhase[]>([])
  const pendingResetRef = useRef(false)

  // Client-side wall-clock timestamps
  const interactionStartRef = useRef(0)
  const clientPhaseStartRef = useRef(0)
  const lastPhaseEndRef = useRef(0)

  const reset = useCallback(() => {
    pendingResetRef.current = true
    interactionStartRef.current = Date.now()
    lastPhaseEndRef.current = 0
    setCompletedSnapshot([])
    setCurrentLabel(null)
    setTotalSnapshot(0)
  }, [])

  useEffect(() => {
    if (!conversationId) {
      phaseRef.current = null
      completedRef.current = []
      clientPhaseStartRef.current = 0
      lastPhaseEndRef.current = 0
      setCurrentLabel(null)
      setCompletedSnapshot([])
      setTotalSnapshot(0)
      return
    }

    let active = true
    let sawEvent = false

    const handlePhaseChange = (nextPhase: AgentPhaseState | null): void => {
      if (!active) return

      // On the first non-null event after a reset, clear accumulated data.
      if (pendingResetRef.current && nextPhase) {
        pendingResetRef.current = false
        phaseRef.current = null
        completedRef.current = []
        lastPhaseEndRef.current = 0
      }

      const prevPhase = phaseRef.current
      const now = Date.now()

      // Transition: had phase -> null (run ended)
      if (prevPhase && !nextPhase) {
        const durationMs = Math.max(0, now - clientPhaseStartRef.current)
        completedRef.current = [...completedRef.current, { label: prevPhase.label, durationMs }]
        phaseRef.current = null
        lastPhaseEndRef.current = now
        clientPhaseStartRef.current = 0

        setCurrentLabel(null)
        setCompletedSnapshot([...completedRef.current])
        setTotalSnapshot(now - interactionStartRef.current)
        return
      }

      // Transition: had phase -> different phase
      if (prevPhase && nextPhase) {
        const samePhase =
          prevPhase.label === nextPhase.label && prevPhase.startedAt === nextPhase.startedAt
        if (!samePhase) {
          const durationMs = Math.max(0, now - clientPhaseStartRef.current)
          completedRef.current = [...completedRef.current, { label: prevPhase.label, durationMs }]
          phaseRef.current = nextPhase
          clientPhaseStartRef.current = now
          setCurrentLabel(nextPhase.label)
        }
        return
      }

      // Transition: no phase -> new phase (run started)
      if (!prevPhase && nextPhase) {
        phaseRef.current = nextPhase
        const interactionStartedAt =
          interactionStartRef.current > 0 ? interactionStartRef.current : now
        if (interactionStartRef.current === 0) {
          interactionStartRef.current = interactionStartedAt
        }
        // Use lastPhaseEndRef if available (continuation gap absorbed into
        // this phase), otherwise use interactionStartRef (first run, includes
        // IPC + server setup time from when user hit send).
        clientPhaseStartRef.current =
          lastPhaseEndRef.current > 0 ? lastPhaseEndRef.current : interactionStartedAt
        setCurrentLabel(nextPhase.label)
        return
      }
    }

    const unsubscribe = api.onAgentPhase((payload) => {
      if (payload.conversationId !== conversationId) return
      sawEvent = true
      handlePhaseChange(payload.phase)
    })

    // Bootstrap from snapshot if no events arrived yet
    void api
      .getAgentPhase(conversationId)
      .then((snapshot) => {
        if (!active || sawEvent) return
        handlePhaseChange(snapshot)
      })
      .catch(() => {
        // No-op: snapshot bootstrap is best-effort
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [conversationId])

  // Elapsed time ticker — only runs when a phase is active.
  // Updates both the current phase elapsed and total elapsed.
  useEffect(() => {
    if (!currentLabel || !clientPhaseStartRef.current) {
      setElapsedMs(0)
      return
    }

    const tick = (): void => {
      const now = Date.now()
      setElapsedMs(Math.max(0, now - clientPhaseStartRef.current))
      setTotalSnapshot(Math.max(0, now - interactionStartRef.current))
    }
    tick()
    const interval = setInterval(tick, DELAY_MS)
    return () => clearInterval(interval)
  }, [currentLabel])

  const current = currentLabel ? { label: currentLabel, elapsedMs } : null
  const completed = current ? completedRef.current : completedSnapshot

  return { current, completed, totalElapsedMs: totalSnapshot, reset }
}
