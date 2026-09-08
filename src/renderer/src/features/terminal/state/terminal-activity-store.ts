import type {
  TerminalActivitySnapshot,
  TerminalActivityStatus,
  TerminalActivitySummary,
} from '@shared/types/terminal'
import { terminalKeyOf } from '@shared/types/terminal'
import { create } from 'zustand'

interface TerminalActivityStoreState {
  readonly revision: number
  readonly initialized: boolean
  readonly truncated: boolean
  readonly summariesByKey: ReadonlyMap<string, TerminalActivitySummary>
  readonly runningCountByOwner: ReadonlyMap<string, number>
  readonly applySnapshot: (snapshot: TerminalActivitySnapshot) => void
  readonly reset: () => void
}

interface TerminalActivityProjection {
  readonly truncated: boolean
  readonly summariesByKey: ReadonlyMap<string, TerminalActivitySummary>
  readonly runningCountByOwner: ReadonlyMap<string, number>
}

const EMPTY_SUMMARIES = new Map<string, TerminalActivitySummary>()
const EMPTY_COUNTS = new Map<string, number>()

function projectSnapshot(snapshot: TerminalActivitySnapshot): TerminalActivityProjection {
  const summariesByKey = new Map<string, TerminalActivitySummary>()
  for (const summary of snapshot.summaries) {
    summariesByKey.set(terminalKeyOf(summary.ownerKey, summary.terminalId), summary)
  }

  const runningCountByOwner = new Map<string, number>()
  for (const summary of summariesByKey.values()) {
    if (summary.activityStatus !== 'running') continue
    runningCountByOwner.set(summary.ownerKey, (runningCountByOwner.get(summary.ownerKey) ?? 0) + 1)
  }

  return { summariesByKey, runningCountByOwner, truncated: snapshot.truncated }
}

export const useTerminalActivityStore = create<TerminalActivityStoreState>((set) => ({
  revision: -1,
  initialized: false,
  truncated: false,
  summariesByKey: EMPTY_SUMMARIES,
  runningCountByOwner: EMPTY_COUNTS,
  applySnapshot(snapshot) {
    set((state) => {
      // The listener is registered before the initial invoke. Ignore a slow
      // older invoke response if a newer event already converged the store.
      if (snapshot.revision <= state.revision) return state
      return {
        ...projectSnapshot(snapshot),
        revision: snapshot.revision,
        initialized: true,
      }
    })
  },
  reset() {
    set({
      revision: -1,
      initialized: false,
      truncated: false,
      summariesByKey: EMPTY_SUMMARIES,
      runningCountByOwner: EMPTY_COUNTS,
    })
  },
}))

/** Synchronous conservative state for Project Action terminal selection. */
export function getTerminalActivityStatus(
  ownerKey: string,
  terminalId: string,
): TerminalActivityStatus {
  return (
    useTerminalActivityStore.getState().summariesByKey.get(terminalKeyOf(ownerKey, terminalId))
      ?.activityStatus ?? 'unknown'
  )
}

export function getTerminalProjectActionPending(ownerKey: string, terminalId: string) {
  return (
    useTerminalActivityStore.getState().summariesByKey.get(terminalKeyOf(ownerKey, terminalId))
      ?.projectActionPending ?? false
  )
}

export function getRunningTerminalCount(ownerKey: string) {
  return useTerminalActivityStore.getState().runningCountByOwner.get(ownerKey) ?? 0
}

export function useRunningTerminalCount(ownerKey: string) {
  return useTerminalActivityStore((state) => state.runningCountByOwner.get(ownerKey) ?? 0)
}

export function useRunningTerminalCounts() {
  return useTerminalActivityStore((state) => state.runningCountByOwner)
}
