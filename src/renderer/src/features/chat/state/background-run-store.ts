import type { AgentSendPayload } from '@shared/types/agent'
import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import type { SessionId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleConfig } from '@shared/types/waggle'
import { create } from 'zustand'
import { applyAgentTransportEvent } from '@/features/chat/lib/chat-stream-state'
import { api } from '@/shared/lib/ipc'
import {
  loadRecoverableBackgroundRuns,
  persistRecoverableBackgroundRuns,
} from './background-run-recovery-storage'

interface ActiveRunRenderSnapshot {
  readonly messages: readonly UIMessage[]
  readonly updatedAt: number
}

interface WorktreeLaunchSourceSnapshot {
  readonly sessionId: SessionId
  readonly worktreeLaunch?: WorktreeLaunchSnapshot
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
  applyRunRenderEvent: (id: SessionId, event: AgentTransportEvent) => void
  clearRunRenderSnapshot: (id: SessionId) => void
  getWorktreeLaunch: (id: SessionId) => WorktreeLaunchSnapshot | null
  setWorktreeLaunch: (id: SessionId, launch: WorktreeLaunchSnapshot | null) => void
  setFirstSendRecovery: (id: SessionId, recovery: FirstSendRecovery | null) => void
  reconcileTerminalRun: (id: SessionId) => Promise<void>
  initialize: () => Promise<void>
}

function launchesFromSnapshots(
  snapshots: readonly (WorktreeLaunchSourceSnapshot | null)[],
): Map<SessionId, WorktreeLaunchSnapshot> {
  const launches = new Map<SessionId, WorktreeLaunchSnapshot>()
  for (const snapshot of snapshots) {
    if (snapshot?.worktreeLaunch) launches.set(snapshot.sessionId, snapshot.worktreeLaunch)
  }
  return launches
}

function mergeLatestLaunches(
  ...sources: readonly ReadonlyMap<SessionId, WorktreeLaunchSnapshot>[]
) {
  const launches = new Map<SessionId, WorktreeLaunchSnapshot>()
  for (const source of sources) {
    for (const [sessionId, launch] of source) {
      const existing = launches.get(sessionId)
      if (!existing || launch.updatedAt >= existing.updatedAt) launches.set(sessionId, launch)
    }
  }
  return launches
}

const INTERRUPTED_FIRST_SEND_MESSAGE =
  'The worktree launch was interrupted before the task was delivered. Retry, work locally, or cancel to restore the draft.'

function interruptedFirstSendLaunch(
  launch: WorktreeLaunchSnapshot | undefined,
): WorktreeLaunchSnapshot {
  if (launch?.status === 'failed') return launch
  const now = Date.now()
  return {
    ...launch,
    status: 'failed',
    stage: launch?.stage ?? 'preparing-workspace',
    startedAt: launch?.startedAt ?? now,
    updatedAt: now,
    details: launch
      ? [...launch.details, INTERRUPTED_FIRST_SEND_MESSAGE]
      : [INTERRUPTED_FIRST_SEND_MESSAGE],
    errorMessage: INTERRUPTED_FIRST_SEND_MESSAGE,
  }
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

function addActiveRunToState(state: BackgroundRunState, id: SessionId) {
  if (state.activeRunIds.has(id)) return state
  return { activeRunIds: new Set([...state.activeRunIds, id]) }
}

function removeActiveRunFromState(state: BackgroundRunState, id: SessionId) {
  if (!state.activeRunIds.has(id)) return state
  const activeRunIds = new Set(state.activeRunIds)
  activeRunIds.delete(id)
  return { activeRunIds }
}

export const useBackgroundRunStore = create<BackgroundRunState>((set, get) => ({
  activeRunIds: new Set<SessionId>(),
  renderSnapshotsBySessionId: new Map<SessionId, ActiveRunRenderSnapshot>(),
  worktreeLaunchBySessionId: new Map<SessionId, WorktreeLaunchSnapshot>(),
  firstSendRecoveryBySessionId: new Map<SessionId, FirstSendRecovery>(),

  addActiveRun(id: SessionId) {
    set((state) => addActiveRunToState(state, id))
  },

  removeActiveRun(id: SessionId) {
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
        updatedAt: Date.now(),
      })
      return { renderSnapshotsBySessionId: next }
    })
  },

  applyRunRenderEvent(id: SessionId, event: AgentTransportEvent) {
    set((state) => {
      const existing = state.renderSnapshotsBySessionId.get(id)
      if (!existing) {
        return state
      }
      const next = new Map(state.renderSnapshotsBySessionId)
      next.set(id, {
        messages: applyAgentTransportEvent([...existing.messages], event),
        updatedAt: Date.now(),
      })
      return { renderSnapshotsBySessionId: next }
    })
  },

  clearRunRenderSnapshot(id: SessionId) {
    set((state) => {
      if (!state.renderSnapshotsBySessionId.has(id)) return state
      const next = new Map(state.renderSnapshotsBySessionId)
      next.delete(id)
      return { renderSnapshotsBySessionId: next }
    })
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
    const runs = await api.listActiveRuns()
    const ids = new Set<SessionId>(runs.map((r) => r.sessionId))
    const snapshots = await Promise.all(runs.map((run) => api.getBackgroundRun(run.sessionId)))
    const persisted = loadRecoverableBackgroundRuns()
    const launches = mergeLatestLaunches(launchesFromSnapshots(snapshots), persisted.launches)
    const reconciled = await reconcilePersistedFirstSends(ids, launches, persisted.recoveries)
    set((state) => {
      const next = mergeInitializedRecoveryState(state, ids, reconciled)
      persistRecoveryState(next.worktreeLaunchBySessionId, next.firstSendRecoveryBySessionId)
      return next
    })
  },
}))
