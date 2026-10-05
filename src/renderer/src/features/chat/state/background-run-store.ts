import type { AgentSendPayload } from '@shared/types/agent'
import type { ActiveAgentRunInfo, WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleConfig } from '@shared/types/waggle'
import { create } from 'zustand'
import type { AgentCompactionStatus } from '@/features/chat/lib/compaction-lifecycle'
import { api } from '@/shared/lib/ipc'
import {
  addActiveRunToState,
  mergeRestoredRunModels,
  removeActiveRunFromState,
} from './background-run-active-state'
import {
  captureActivityRevisions,
  loadActiveActivityState,
  noteActivityLifecycleChange,
  restoreCompactionSnapshots,
  retainUnchangedActivities,
} from './background-run-activity-restore'
import {
  interruptedFirstSendLaunch,
  launchesFromSnapshots,
  mergeLatestLaunches,
} from './background-run-launch-model'
import {
  loadRecoverableBackgroundRuns,
  persistRecoverableBackgroundRuns,
} from './background-run-recovery-storage'
import {
  type RunRenderSnapshot,
  withoutRunRenderSnapshot,
  withoutSettledRunRenderSnapshot,
  withRunCompactionStatus,
  withRunRenderEvent,
  withRunRenderMessages,
  withSettledRunRenderSnapshot,
} from './background-run-render-state'

export interface FirstSendRecovery {
  readonly payload: AgentSendPayload
  readonly waggleConfig: WaggleConfig | null
  readonly model: SupportedModelId | undefined
}

interface BackgroundRunState {
  activeRunIds: Set<SessionId>
  /** The model each busy Session's current Run reported when it started. */
  runModelBySessionId: Map<SessionId, SupportedModelId>
  renderSnapshotsBySessionId: Map<SessionId, RunRenderSnapshot>
  worktreeLaunchBySessionId: Map<SessionId, WorktreeLaunchSnapshot>
  firstSendRecoveryBySessionId: Map<SessionId, FirstSendRecovery>
  addActiveRun: (id: SessionId, model?: SupportedModelId) => void
  removeActiveRun: (id: SessionId) => void
  hasActiveRun: (id: SessionId) => boolean
  getRunRenderSnapshot: (id: SessionId) => RunRenderSnapshot | null
  setRunRenderMessages: (id: SessionId, messages: readonly UIMessage[]) => void
  setRunCompactionStatus: (id: SessionId, status: AgentCompactionStatus | null) => void
  applyRunRenderEvent: (id: SessionId, event: AgentTransportEvent) => void
  clearRunRenderSnapshot: (id: SessionId) => void
  /** A Run settled: the snapshot holds it, so the next Run's start reseeds it. */
  noteRunRenderSnapshotRunSettled: (id: SessionId, runId: string | undefined) => void
  /** The settled Run's Session refreshed: drops the snapshot unless a later Run seeded it. */
  clearSettledRunRenderSnapshot: (id: SessionId) => void
  getWorktreeLaunch: (id: SessionId) => WorktreeLaunchSnapshot | null
  setWorktreeLaunch: (id: SessionId, launch: WorktreeLaunchSnapshot | null) => void
  setFirstSendRecovery: (id: SessionId, recovery: FirstSendRecovery | null) => void
  reconcileTerminalRun: (id: SessionId) => Promise<void>
  initialize: () => Promise<void>
}

function persistRecoveryState(
  launches: ReadonlyMap<SessionId, WorktreeLaunchSnapshot>,
  recoveries: ReadonlyMap<SessionId, FirstSendRecovery>,
) {
  persistRecoverableBackgroundRuns({
    launches: new Map(launches),
    recoveries: new Map(recoveries),
  })
}

async function reconcilePersistedFirstSends(
  activeRunIds: ReadonlySet<SessionId>,
  launches: ReadonlyMap<SessionId, WorktreeLaunchSnapshot>,
  recoveries: ReadonlyMap<SessionId, FirstSendRecovery>,
) {
  const nextLaunches = new Map(launches)
  const nextRecoveries = new Map(recoveries)

  await Promise.all(
    [...recoveries.keys()].map(async (sessionId) => {
      if (activeRunIds.has(sessionId)) return
      try {
        const session = await api.getSessionDetail(sessionId)
        if (!session || session.messages.length > 0) {
          nextLaunches.delete(sessionId)
          nextRecoveries.delete(sessionId)
          return
        }

        const launch = nextLaunches.get(sessionId)
        if (session.environmentMode === 'worktree' || launch) {
          nextLaunches.set(sessionId, interruptedFirstSendLaunch(launch))
        } else {
          nextRecoveries.delete(sessionId)
        }
      } catch {
        // Unknown durable state must not expose a retry that could duplicate a delivered prompt.
        // Preserve the last snapshot until a later lifecycle event can reconcile it accurately.
      }
    }),
  )

  return { launches: nextLaunches, recoveries: nextRecoveries }
}

function reconcileTerminalRecoveryState(input: {
  readonly id: SessionId
  readonly session: Awaited<ReturnType<typeof api.getSessionDetail>>
  readonly launchAtCompletion: WorktreeLaunchSnapshot | undefined
  readonly recoveryAtCompletion: FirstSendRecovery | undefined
  readonly state: BackgroundRunState
}) {
  const currentLaunch = input.state.worktreeLaunchBySessionId.get(input.id)
  const currentRecovery = input.state.firstSendRecoveryBySessionId.get(input.id)
  const launchIsUnchanged = currentLaunch === input.launchAtCompletion
  const recoveryIsUnchanged = currentRecovery === input.recoveryAtCompletion
  const launches = new Map(input.state.worktreeLaunchBySessionId)
  const recoveries = new Map(input.state.firstSendRecoveryBySessionId)

  if (!input.session || input.session.messages.length > 0) {
    if (launchIsUnchanged) launches.delete(input.id)
    if (recoveryIsUnchanged) recoveries.delete(input.id)
    return { launches, recoveries }
  }
  if (!launchIsUnchanged || !recoveryIsUnchanged) return null
  if (
    input.recoveryAtCompletion &&
    (input.session.environmentMode === 'worktree' || input.launchAtCompletion)
  ) {
    launches.set(input.id, interruptedFirstSendLaunch(input.launchAtCompletion))
    return { launches, recoveries }
  }
  if (input.launchAtCompletion?.status !== 'failed') launches.delete(input.id)
  return { launches, recoveries }
}

function mergeInitializedRecoveryState(
  state: BackgroundRunState,
  activeRunIds: ReadonlySet<SessionId>,
  runs: readonly ActiveAgentRunInfo[],
  reconciled: Awaited<ReturnType<typeof reconcilePersistedFirstSends>>,
) {
  return {
    activeRunIds: new Set([...activeRunIds, ...state.activeRunIds]),
    runModelBySessionId: mergeRestoredRunModels(state.runModelBySessionId, activeRunIds, runs),
    // Live renderer events received while initialization awaited IPC are always newer.
    worktreeLaunchBySessionId: new Map([
      ...reconciled.launches,
      ...state.worktreeLaunchBySessionId,
    ]),
    firstSendRecoveryBySessionId: new Map([
      ...reconciled.recoveries,
      ...state.firstSendRecoveryBySessionId,
    ]),
  }
}

function initialBackgroundRunState() {
  return {
    activeRunIds: new Set<SessionId>(),
    runModelBySessionId: new Map<SessionId, SupportedModelId>(),
    renderSnapshotsBySessionId: new Map<SessionId, RunRenderSnapshot>(),
    worktreeLaunchBySessionId: new Map<SessionId, WorktreeLaunchSnapshot>(),
    firstSendRecoveryBySessionId: new Map<SessionId, FirstSendRecovery>(),
  }
}

function mergeCurrentActivityState(
  state: BackgroundRunState,
  current: ReturnType<typeof retainUnchangedActivities>,
  reconciled: Awaited<ReturnType<typeof reconcilePersistedFirstSends>>,
) {
  const next = mergeInitializedRecoveryState(state, current.ids, current.runs, reconciled)
  persistRecoveryState(next.worktreeLaunchBySessionId, next.firstSendRecoveryBySessionId)
  return {
    ...next,
    renderSnapshotsBySessionId: restoreCompactionSnapshots(
      state,
      current.compactions,
      current.runs,
    ),
  }
}

export const useBackgroundRunStore = create<BackgroundRunState>((set, get) => ({
  ...initialBackgroundRunState(),

  addActiveRun(id: SessionId, model?: SupportedModelId) {
    noteActivityLifecycleChange(id)
    set((state) => addActiveRunToState(state, id, model))
  },

  removeActiveRun(id: SessionId) {
    noteActivityLifecycleChange(id)
    set((state) => removeActiveRunFromState(state, id))
  },

  hasActiveRun(id: SessionId) {
    return get().activeRunIds.has(id)
  },

  getRunRenderSnapshot(id: SessionId) {
    return get().renderSnapshotsBySessionId.get(id) ?? null
  },

  setRunRenderMessages(id: SessionId, messages: readonly UIMessage[]) {
    set((state) => withRunRenderMessages(state, id, messages))
  },

  setRunCompactionStatus(id: SessionId, status: AgentCompactionStatus | null) {
    set((state) => withRunCompactionStatus(state, id, status, state.activeRunIds.has(id)))
  },

  applyRunRenderEvent(id: SessionId, event: AgentTransportEvent) {
    set((state) => withRunRenderEvent(state, id, event))
  },

  clearRunRenderSnapshot(id: SessionId) {
    set((state) => withoutRunRenderSnapshot(state, id))
  },

  noteRunRenderSnapshotRunSettled(id: SessionId, runId: string | undefined) {
    set((state) => withSettledRunRenderSnapshot(state, id, runId))
  },

  clearSettledRunRenderSnapshot(id: SessionId) {
    set((state) => withoutSettledRunRenderSnapshot(state, id))
  },

  getWorktreeLaunch(id: SessionId) {
    return get().worktreeLaunchBySessionId.get(id) ?? null
  },

  setWorktreeLaunch(id: SessionId, launch: WorktreeLaunchSnapshot | null) {
    set((state) => {
      const next = new Map(state.worktreeLaunchBySessionId)
      if (launch === null) {
        next.delete(id)
      } else {
        next.set(id, launch)
      }
      persistRecoveryState(next, state.firstSendRecoveryBySessionId)
      return { worktreeLaunchBySessionId: next }
    })
  },

  setFirstSendRecovery(id: SessionId, recovery: FirstSendRecovery | null) {
    set((state) => {
      const next = new Map(state.firstSendRecoveryBySessionId)
      if (recovery === null) {
        next.delete(id)
      } else {
        next.set(id, recovery)
      }
      persistRecoveryState(state.worktreeLaunchBySessionId, next)
      return { firstSendRecoveryBySessionId: next }
    })
  },

  async reconcileTerminalRun(id: SessionId) {
    const launchAtCompletion = get().worktreeLaunchBySessionId.get(id)
    const recoveryAtCompletion = get().firstSendRecoveryBySessionId.get(id)
    if (!launchAtCompletion && !recoveryAtCompletion) return

    let session: Awaited<ReturnType<typeof api.getSessionDetail>>
    try {
      session = await api.getSessionDetail(id)
    } catch {
      // A transient read failure is not evidence that retrying is safe.
      return
    }

    set((state) => {
      const reconciled = reconcileTerminalRecoveryState({
        id,
        session,
        launchAtCompletion,
        recoveryAtCompletion,
        state,
      })
      if (!reconciled) return state
      persistRecoveryState(reconciled.launches, reconciled.recoveries)
      return {
        worktreeLaunchBySessionId: reconciled.launches,
        firstSendRecoveryBySessionId: reconciled.recoveries,
      }
    })
  },

  async initialize() {
    const capturedActivityRevisions = captureActivityRevisions()
    const { ids, compactions, runs, snapshots } = await loadActiveActivityState()
    const persisted = loadRecoverableBackgroundRuns()
    const launches = mergeLatestLaunches(launchesFromSnapshots(snapshots), persisted.launches)
    const reconciled = await reconcilePersistedFirstSends(ids, launches, persisted.recoveries)
    set((state) => {
      const current = retainUnchangedActivities(ids, compactions, runs, capturedActivityRevisions)
      return mergeCurrentActivityState(state, current, reconciled)
    })
  },
}))
