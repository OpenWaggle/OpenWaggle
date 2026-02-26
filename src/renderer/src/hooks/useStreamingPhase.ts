import type { AgentPhaseState } from '@shared/types/phase'
import { useEffect, useRef, useState } from 'react'

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
  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export function useStreamingPhase(agentPhase: AgentPhaseState | null): StreamingPhaseState {
  const [elapsedMs, setElapsedMs] = useState(0)
  const phaseRef = useRef<AgentPhaseState | null>(null)
  const completedRef = useRef<CompletedPhase[]>([])
  const [completedSnapshot, setCompletedSnapshot] = useState<readonly CompletedPhase[]>([])

  if (!phaseRef.current && agentPhase) {
    completedRef.current = []
    setCompletedSnapshot([])
    phaseRef.current = agentPhase
  }

  if (phaseRef.current && agentPhase) {
    const samePhase =
      phaseRef.current.label === agentPhase.label &&
      phaseRef.current.startedAt === agentPhase.startedAt
    if (!samePhase) {
      const durationMs = Math.max(0, agentPhase.startedAt - phaseRef.current.startedAt)
      completedRef.current = [
        ...completedRef.current,
        { label: phaseRef.current.label, durationMs },
      ]
      phaseRef.current = agentPhase
    }
  }

  if (phaseRef.current && !agentPhase) {
    const durationMs = Math.max(0, Date.now() - phaseRef.current.startedAt)
    completedRef.current = [...completedRef.current, { label: phaseRef.current.label, durationMs }]
    phaseRef.current = null
    setCompletedSnapshot([...completedRef.current])
  }

  useEffect(() => {
    if (!agentPhase) {
      setElapsedMs(0)
      return
    }

    setElapsedMs(Math.max(0, Date.now() - agentPhase.startedAt))
    const interval = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - agentPhase.startedAt))
    }, 1000)

    return () => clearInterval(interval)
  }, [agentPhase])

  const current = agentPhase ? { label: agentPhase.label, elapsedMs } : null
  const completed = current ? completedRef.current : completedSnapshot
  const totalElapsedMs = completed.reduce((sum, phase) => sum + phase.durationMs, 0)

  return { current, completed, totalElapsedMs }
}
