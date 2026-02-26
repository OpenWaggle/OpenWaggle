import type { OrchestrationRunRecord } from '@shared/types/orchestration'
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

const KIND_TO_LABEL: Record<string, string> = {
  analysis: 'Researching',
  debugging: 'Debugging',
  refactoring: 'Refactoring',
  testing: 'Testing',
  documentation: 'Documenting',
  'repo-edit': 'Editing',
  general: 'Executing',
}

// Higher index = higher priority when multiple tasks run concurrently
const KIND_PRIORITY: readonly string[] = [
  'general',
  'documentation',
  'analysis',
  'testing',
  'refactoring',
  'debugging',
  'repo-edit',
]

function derivePhaseLabel(
  isLoading: boolean,
  runs: readonly OrchestrationRunRecord[],
  hasStreamingContent: boolean,
): string | null {
  if (!isLoading) return null

  const latestRun = runs[0]

  // No orchestration at all
  if (!latestRun) {
    return hasStreamingContent ? 'Writing' : 'Thinking'
  }

  if (latestRun.status === 'running') {
    const tasks = Object.values(latestRun.tasks)
    const allQueued = tasks.length > 0 && tasks.every((t) => t.status === 'queued')
    if (allQueued) return 'Planning'

    const allTerminal = tasks.every(
      (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled',
    )
    if (allTerminal) return 'Reviewing'

    // Some tasks running/retrying — pick label by kind priority
    const activeTasks = tasks.filter((t) => t.status === 'running' || t.status === 'retrying')
    if (activeTasks.length > 0) {
      let bestKind = 'general'
      let bestPriority = -1
      for (const task of activeTasks) {
        const priority = KIND_PRIORITY.indexOf(task.kind)
        if (priority > bestPriority) {
          bestPriority = priority
          bestKind = task.kind
        }
      }
      return KIND_TO_LABEL[bestKind] ?? 'Executing'
    }

    return 'Executing'
  }

  // Run finished but still loading — writing the final response
  return 'Writing'
}

export function useStreamingPhase(
  isLoading: boolean,
  orchestrationRuns: readonly OrchestrationRunRecord[],
  hasStreamingContent: boolean,
): StreamingPhaseState {
  const [elapsedMs, setElapsedMs] = useState(0)
  const phaseRef = useRef<{ label: string; startedAt: number } | null>(null)
  const completedRef = useRef<CompletedPhase[]>([])
  const prevLoadingRef = useRef(false)
  const [completedSnapshot, setCompletedSnapshot] = useState<readonly CompletedPhase[]>([])

  const currentLabel = derivePhaseLabel(isLoading, orchestrationRuns, hasStreamingContent)

  // Reset on new run (isLoading transitions false → true)
  if (isLoading && !prevLoadingRef.current) {
    completedRef.current = []
    setCompletedSnapshot([])
  }
  prevLoadingRef.current = isLoading

  // Track phase transitions — push completed phases
  if (currentLabel !== null) {
    if (!phaseRef.current || phaseRef.current.label !== currentLabel) {
      // Push the previous phase as completed
      if (phaseRef.current) {
        const durationMs = Date.now() - phaseRef.current.startedAt
        completedRef.current = [
          ...completedRef.current,
          { label: phaseRef.current.label, durationMs },
        ]
      }
      phaseRef.current = { label: currentLabel, startedAt: Date.now() }
    }
  }

  if (currentLabel === null && phaseRef.current) {
    // isLoading went false — finalize the last phase
    const durationMs = Date.now() - phaseRef.current.startedAt
    completedRef.current = [...completedRef.current, { label: phaseRef.current.label, durationMs }]
    phaseRef.current = null
    setCompletedSnapshot([...completedRef.current])
  }

  useEffect(() => {
    if (!currentLabel) {
      setElapsedMs(0)
      return
    }

    // Immediately set elapsed from the ref
    setElapsedMs(phaseRef.current ? Date.now() - phaseRef.current.startedAt : 0)

    const interval = setInterval(() => {
      if (phaseRef.current) {
        setElapsedMs(Date.now() - phaseRef.current.startedAt)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [currentLabel])

  const current = currentLabel !== null ? { label: currentLabel, elapsedMs } : null
  const completed = current ? completedRef.current : completedSnapshot
  const totalElapsedMs = completed.reduce((sum, p) => sum + p.durationMs, 0)

  return { current, completed, totalElapsedMs }
}

// Exported for testing
export { derivePhaseLabel as _derivePhaseLabel }
