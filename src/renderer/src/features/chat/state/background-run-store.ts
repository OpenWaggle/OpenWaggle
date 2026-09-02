import type { AgentSendPayload } from '@shared/types/agent'
import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleConfig } from '@shared/types/waggle'
import { create } from 'zustand'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import type { AgentCompactionStatus } from '@/features/chat/lib/compaction-lifecycle'
import { api } from '@/shared/lib/ipc'
import { addActiveRunToState, removeActiveRunFromState } from './background-run-active-state'
import {
  captureActivityRevisions,
  isActiveCompaction,
  isAgentRun,
  noteActivityLifecycleChange,
  restoreCompactionSnapshots,
  retainUnchangedActivities,
} from './background-run-activity-restore'
import { applyCompactionSnapshotEvent } from './background-run-compaction'
import {
  interruptedFirstSendLaunch,
  launchesFromSnapshots,
  mergeLatestLaunches,
} from './background-run-launch-model'
import {
  loadRecoverableBackgroundRuns,
  persistRecoverableBackgroundRuns,
} from './background-run-recovery-storage'
import { withoutRunRenderSnapshot, withRunCompactionStatus } from './background-run-render-state'

interface ActiveRunRenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly compactionStatus: AgentCompactionStatus | null
  readonly updatedAt: number
}

export interface FirstSendRecovery {
  readonly payload: AgentSendPayload
  readonly waggleConfig: WaggleConfig | null
  readonly model: SupportedModelId
}

interface BackgroundRunState {
  activeRunIds: Set<SessionId>
  renderSnapshotsBySessionId: Map<SessionId, ActiveRunRenderSnapshot>
  worktreeLaunchBySessionId: Map<SessionId, WorktreeLaunchSnapshot>
  firstSendRecoveryBySessionId: Map<SessionId, FirstSendRecovery>
  addActiveRun: (id: SessionId) => void
  removeActiveRun: (id: SessionId) => void
  hasActiveRun: (id: SessionId) => boolean
  getRunRenderSnapshot: (id: SessionId) => ActiveRunRenderSnapshot | null
  setRunRenderMessages: (id: SessionId, messages: readonly UIMessage[]) => void
  setRunCompactionStatus: (id: SessionId, status: AgentCompactionStatus | null) => void
  applyRunRenderEvent: (id: SessionId, event: AgentTransportEvent) => void
  clearRunRenderSnapshot: (id: SessionId) => void
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
  reconciled: Awaited<ReturnType<typeof reconcilePersistedFirstSends>>,
) {
  return {
    activeRunIds: new Set([...activeRunIds, ...state.activeRunIds]),
    // Live renderer events received while initialization awaited IPC are newer
    // than any snapshot being reconciled, regardless of wall-clock timestamps.
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
    renderSnapshotsBySessionId: new Map<SessionId, ActiveRunRenderSnapshot>(),
    worktreeLaunchBySessionId: new Map<SessionId, WorktreeLaunchSnapshot>(),
    firstSendRecoveryBySessionId: new Map<SessionId, FirstSendRecovery>(),
  }
}

async function loadActiveActivityState() {
  const activities = await api.listActiveRuns()
  const runs = activities.filter(isAgentRun)
  return {
    ids: new Set<SessionId>(activities.map((activity) => activity.sessionId)),
    compactions: activities.filter(isActiveCompaction),
    snapshots: await Promise.all(runs.map((run) => api.getBackgroundRun(run.sessionId))),
  }
}

function mergeCurrentActivityState(
  state: BackgroundRunState,
  current: ReturnType<typeof retainUnchangedActivities>,
  reconciled: Awaited<ReturnType<typeof reconcilePersistedFirstSends>>,
) {
  const next = mergeInitializedRecoveryState(state, current.ids, reconciled)
  persistRecoveryState(next.worktreeLaunchBySessionId, next.firstSendRecoveryBySessionId)
  return {
    ...next,
    renderSnapshotsBySessionId: restoreCompactionSnapshots(state, current.compactions),
  }
}

export const useBackgroundRunStore = create<BackgroundRunState>((set, get) => ({
  ...initialBackgroundRunState(),

  addActiveRun(id: SessionId) {
    noteActivityLifecycleChange(id)
    set((state) => addActiveRunToState(state, id))
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
    set((state) => {
      const next = new Map(state.renderSnapshotsBySessionId)
      next.set(id, {
        messages: [...messages],
        compactionStatus: state.renderSnapshotsBySessionId.get(id)?.compactionStatus ?? null,
        updatedAt: Date.now(),
      })
      return { renderSnapshotsBySessionId: next }
    })
  },

  setRunCompactionStatus(id: SessionId, status: AgentCompactionStatus | null) {
    set((state) => withRunCompactionStatus(state, id, status, state.activeRunIds.has(id)))
  },

  applyRunRenderEvent(id: SessionId, event: AgentTransportEvent) {
    set((state) => {
      const existing = state.renderSnapshotsBySessionId.get(id)
      if (!existing && event.type !== 'compaction_start') {
        return state
      }
      const snapshot = existing ?? { messages: [], compactionStatus: null, updatedAt: Date.now() }
      const next = new Map(state.renderSnapshotsBySessionId)
      next.set(id, {
        messages: applyAgentTransportEvent([...snapshot.messages], event),
        compactionStatus: applyCompactionSnapshotEvent(
          snapshot.compactionStatus,
          event,
          snapshot.messages,
        ),
        updatedAt: Date.now(),
      })
      return { renderSnapshotsBySessionId: next }
    })
  },

  clearRunRenderSnapshot(id: SessionId) {
    set((state) => withoutRunRenderSnapshot(state, id))
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
    const { ids, compactions, snapshots } = await loadActiveActivityState()
    const persisted = loadRecoverableBackgroundRuns()
    const launches = mergeLatestLaunches(launchesFromSnapshots(snapshots), persisted.launches)
    const reconciled = await reconcilePersistedFirstSends(ids, launches, persisted.recoveries)
    set((state) => {
      const current = retainUnchangedActivities(ids, compactions, capturedActivityRevisions)
      return mergeCurrentActivityState(state, current, reconciled)
    })
  },
}))
