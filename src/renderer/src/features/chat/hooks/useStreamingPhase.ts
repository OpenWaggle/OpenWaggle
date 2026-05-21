import { TIME_UNIT } from '@shared/constants/time'
import type { SessionId } from '@shared/types/brand'
import type { AgentPhaseState } from '@shared/types/phase'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'

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
 * and gaps between Pi runtime turns are fully captured. The server-provided
 * `startedAt` is only used to detect same-phase dedup; all duration math
 * uses `Date.now()` on the client.
 *
 * Between-run gaps (IPC reconnect, runtime setup, model latency) are
 * attributed to the first phase of the next run (typically "Thinking"),
 * giving an accurate picture of where time was spent from the user's
 * perspective.
 */
export function useStreamingPhase(sessionId: SessionId | null): StreamingPhaseHandle {
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

  function reset() {
    pendingResetRef.current = true
    interactionStartRef.current = Date.now()
    lastPhaseEndRef.current = 0
    setCompletedSnapshot([])
    setCurrentLabel(null)
    setTotalSnapshot(0)
  }

  useEffect(() => {
    pendingResetRef.current = false
    phaseRef.current = null
    completedRef.current = []
    interactionStartRef.current = 0
    clientPhaseStartRef.current = 0
    lastPhaseEndRef.current = 0
    setCurrentLabel(null)
    setElapsedMs(0)
    setCompletedSnapshot([])
    setTotalSnapshot(0)

    if (!sessionId) {
      return
    }

    let active = true
    let sawEvent = false

    const clearPendingReset = (nextPhase: AgentPhaseState | null) => {
      if (!pendingResetRef.current || !nextPhase) return
      pendingResetRef.current = false
      phaseRef.current = null
      completedRef.current = []
      lastPhaseEndRef.current = 0
    }

    const completeCurrentPhase = (prevPhase: AgentPhaseState, now: number) => {
      const durationMs = Math.max(0, now - clientPhaseStartRef.current)
      completedRef.current = [...completedRef.current, { label: prevPhase.label, durationMs }]
      phaseRef.current = null
      lastPhaseEndRef.current = now
      clientPhaseStartRef.current = 0
      setCurrentLabel(null)
      setCompletedSnapshot([...completedRef.current])
      setTotalSnapshot(now - interactionStartRef.current)
    }

    const switchCurrentPhase = (
      prevPhase: AgentPhaseState,
      nextPhase: AgentPhaseState,
      now: number,
    ) => {
      const samePhase =
        prevPhase.label === nextPhase.label && prevPhase.startedAt === nextPhase.startedAt
      if (samePhase) return
      const durationMs = Math.max(0, now - clientPhaseStartRef.current)
      completedRef.current = [...completedRef.current, { label: prevPhase.label, durationMs }]
      phaseRef.current = nextPhase
      clientPhaseStartRef.current = now
      setCurrentLabel(nextPhase.label)
    }

    const startFirstPhase = (nextPhase: AgentPhaseState, now: number) => {
      phaseRef.current = nextPhase
      const phaseStartedAt = nextPhase.startedAt > 0 ? Math.min(nextPhase.startedAt, now) : now
      const interactionStartedAt =
        interactionStartRef.current > 0 ? interactionStartRef.current : phaseStartedAt
      if (interactionStartRef.current === 0) {
        interactionStartRef.current = interactionStartedAt
      }
      // Between-turn gaps are absorbed into the next phase so totals match user-visible latency.
      clientPhaseStartRef.current =
        lastPhaseEndRef.current > 0 ? lastPhaseEndRef.current : interactionStartedAt
      setCurrentLabel(nextPhase.label)
      setElapsedMs(Math.max(0, now - clientPhaseStartRef.current))
      setTotalSnapshot(Math.max(0, now - interactionStartRef.current))
    }

    const handlePhaseChange = (nextPhase: AgentPhaseState | null) => {
      if (!active) return
      clearPendingReset(nextPhase)

      const prevPhase = phaseRef.current
      const now = Date.now()
      if (prevPhase && !nextPhase) {
        completeCurrentPhase(prevPhase, now)
        return
      }
      if (prevPhase && nextPhase) {
        switchCurrentPhase(prevPhase, nextPhase, now)
        return
      }
      if (nextPhase) {
        startFirstPhase(nextPhase, now)
      }
    }

    const unsubscribe = api.onAgentPhase((payload) => {
      if (payload.sessionId !== sessionId) return
      sawEvent = true
      handlePhaseChange(payload.phase)
    })

    // Bootstrap from snapshot if no events arrived yet
    void api
      .getAgentPhase(sessionId)
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
  }, [sessionId])

  // Elapsed time ticker — only runs when a phase is active.
  // Updates both the current phase elapsed and total elapsed.
  useEffect(() => {
    if (!currentLabel || !clientPhaseStartRef.current) {
      setElapsedMs(0)
      return
    }

    const tick = () => {
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
