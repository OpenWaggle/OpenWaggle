import type { SessionId } from '@shared/types/brand'
import type { SessionWorkspace, SessionWorkspaceSelection } from '@shared/types/session'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import {
  forgetTranscriptNodeCache,
  hasEarlierTranscript,
  NEWEST_TRANSCRIPT_WINDOW,
  restoreTranscriptWindow,
  sameWorkspaceSelection,
  TRANSCRIPT_WINDOW_PAGE_ENTRIES,
  type TranscriptWindowTarget,
  transcriptWindowRequest,
} from '../lib/session-workspace-window'
import type { SessionState } from './session-store'

const logger = createRendererLogger('session-store')

export function handleStoreError(
  err: unknown,
  action: string,
  setError: (message: string) => void,
) {
  const message = err instanceof Error ? err.message : String(err)
  logger.error(`Failed to ${action}`, { message })
  setError(`Failed to ${action}: ${message}`)
}

type SessionSet = (partial: Partial<SessionState>) => void
type SessionGet = () => SessionState

/**
 * Reads the workspace's transcript window, putting back the content of entries this window
 * already holds. When one of those is missing, it reads again without naming held nodes.
 */
async function readWorkspace(
  sessionId: SessionId,
  selection: SessionWorkspaceSelection | undefined,
  loaded: SessionWorkspace | null,
) {
  const request = transcriptWindowRequest({ sessionId, loaded, target: windowTarget })
  const workspace = await api.getSessionWorkspace(sessionId, selection, request)
  if (!workspace) {
    forgetTranscriptNodeCache(sessionId)
    return null
  }
  const restored = restoreTranscriptWindow(sessionId, workspace)
  if (restored) return restored
  forgetTranscriptNodeCache(sessionId)
  const { cached: _cached, ...uncached } = request
  const fresh = await api.getSessionWorkspace(sessionId, selection, uncached)
  return fresh ? restoreTranscriptWindow(sessionId, fresh) : null
}

let latestTreeRequestId = 0
let latestWorkspaceRequestId = 0

/**
 * How long a tree read waits before it reads. A Session becomes active a moment before the chat
 * route reads its workspace, which carries the tree: waiting lets that read serve both, instead of
 * moving the tree twice when a Session opens.
 */
export const SESSION_TREE_READ_GRACE_MS = 100

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * One source for a Session's tree and workspace (B5). A tree refresh for the Session whose
 * workspace is shown reads that workspace (whose tree it carries) with the same selection, and
 * identical reads issued while one is in flight share a single trailing read rather than each
 * moving the payload again. A read that started before a change still runs again after it, so a
 * refresh never returns state older than the change that asked for it.
 */
interface WorkspaceFlight {
  readonly key: string
  readonly sessionId: SessionId
  readonly promise: Promise<void>
  /** Calls in the task that started the read join it; later ones wait for a trailing read. */
  joinable: boolean
  trailing: Promise<void> | null
}
let workspaceFlight: WorkspaceFlight | null = null
let treeFlight: WorkspaceFlight | null = null
/** The selection of the most recent workspace read, which tree refreshes keep. */
let lastWorkspaceRead: {
  readonly sessionId: SessionId
  readonly selection: SessionWorkspaceSelection | undefined
} | null = null
/** How far back the shown transcript window reaches; reset when the Session or selection changes. */
let windowTarget: TranscriptWindowTarget = NEWEST_TRANSCRIPT_WINDOW

function workspaceKey(sessionId: SessionId, selection: SessionWorkspaceSelection | undefined) {
  return `${String(sessionId)}|${String(selection?.branchId ?? '')}|${String(selection?.nodeId ?? '')}`
}

function startedFlight(key: string, sessionId: SessionId, promise: Promise<void>) {
  const flight: WorkspaceFlight = { key, sessionId, promise, joinable: true, trailing: null }
  queueMicrotask(() => {
    flight.joinable = false
  })
  return flight
}

function joinOrStart(
  flight: WorkspaceFlight | null,
  key: string,
  start: () => Promise<void>,
): Promise<void> {
  if (flight?.key !== key) return start()
  if (flight.joinable) return flight.promise
  flight.trailing ??= flight.promise.then(start, start)
  return flight.trailing
}

/**
 * A tree read for a Session whose workspace is not shown. It waits out the grace first and leaves
 * the tree to a workspace read that started meanwhile, which carries it.
 */
async function readTree(sessionId: SessionId, requestId: number, set: SessionSet) {
  try {
    await delay(SESSION_TREE_READ_GRACE_MS)
    if (requestId !== latestTreeRequestId) {
      // Wait for it when it is this Session's, so the caller still sees its tree once this ends.
      if (workspaceFlight?.sessionId === sessionId) await workspaceFlight.promise
      return
    }
    const activeSessionTree = await api.getSessionTree(sessionId)
    if (requestId !== latestTreeRequestId) return
    if (activeSessionTree && activeSessionTree.session.id !== sessionId) return
    set({ activeSessionTree, error: null })
  } catch (err) {
    handleStoreError(err, 'refresh session tree', (error) => set({ error }))
  }
}

/** The Session store's tree and workspace reads (B5, ADR 0036). */
export function createSessionWorkspaceReads(set: SessionSet, get: SessionGet) {
  return {
    refreshSessionTree(sessionId: SessionId | null) {
      if (!sessionId) {
        latestTreeRequestId += 1
        latestWorkspaceRequestId += 1
        set({ activeSessionTree: null, activeWorkspace: null })
        return Promise.resolve()
      }
      const shown = get().activeWorkspace
      if (shown?.tree.session.id === sessionId || workspaceFlight?.sessionId === sessionId) {
        const selection =
          lastWorkspaceRead?.sessionId === sessionId ? lastWorkspaceRead.selection : undefined
        return get().refreshSessionWorkspace(sessionId, selection)
      }
      const key = String(sessionId)
      return joinOrStart(treeFlight, key, () => {
        latestTreeRequestId += 1
        const promise = readTree(sessionId, latestTreeRequestId, set)
        const flight = startedFlight(key, sessionId, promise)
        treeFlight = flight
        void promise.finally(() => {
          if (treeFlight === flight) treeFlight = null
        })
        return promise
      })
    },

    refreshSessionWorkspace(sessionId, selection) {
      if (!sessionId) {
        latestTreeRequestId += 1
        latestWorkspaceRequestId += 1
        set({ activeSessionTree: null, activeWorkspace: null })
        return Promise.resolve()
      }
      const key = workspaceKey(sessionId, selection)
      return joinOrStart(workspaceFlight, key, () => {
        const sameView =
          lastWorkspaceRead?.sessionId === sessionId &&
          sameWorkspaceSelection(lastWorkspaceRead.selection, selection)
        if (!sameView) windowTarget = NEWEST_TRANSCRIPT_WINDOW
        lastWorkspaceRead = { sessionId, selection }
        latestWorkspaceRequestId += 1
        latestTreeRequestId += 1
        const requestId = latestWorkspaceRequestId
        const shown = get().activeWorkspace
        const loaded = sameView && shown?.tree.session.id === sessionId ? shown : null
        const promise = readWorkspace(sessionId, selection, loaded).then(
          (activeWorkspace) => {
            if (requestId !== latestWorkspaceRequestId) return
            if (activeWorkspace && activeWorkspace.tree.session.id !== sessionId) return
            set({
              activeWorkspace,
              activeSessionTree: activeWorkspace?.tree ?? null,
              error: null,
            })
          },
          (err: unknown) => {
            handleStoreError(err, 'refresh session workspace', (error) => set({ error }))
          },
        )
        const flight = startedFlight(key, sessionId, promise)
        workspaceFlight = flight
        void promise.finally(() => {
          if (workspaceFlight === flight) workspaceFlight = null
        })
        return promise
      })
    },

    showSessionWorkspace(sessionId, selection) {
      if (!sessionId) return get().refreshSessionWorkspace(null, selection)
      const key = workspaceKey(sessionId, selection)
      // Already shown or being read: a view that mounts again (a project switch, a re-route to
      // the same Session) shows it as it is; changes since are refreshed by their own events.
      if (workspaceFlight?.key === key) return workspaceFlight.trailing ?? workspaceFlight.promise
      const shown = get().activeWorkspace
      if (
        shown?.tree.session.id === sessionId &&
        lastWorkspaceRead?.sessionId === sessionId &&
        workspaceKey(sessionId, lastWorkspaceRead.selection) === key
      ) {
        return Promise.resolve()
      }
      return get().refreshSessionWorkspace(sessionId, selection)
    },

    loadEarlierTranscript(sessionId) {
      const shown = get().activeWorkspace
      if (shown?.tree.session.id !== sessionId || !hasEarlierTranscript(shown)) {
        return Promise.resolve()
      }
      windowTarget = {
        minEntries: shown.transcriptPath.length + TRANSCRIPT_WINDOW_PAGE_ENTRIES,
        includeNodeId: null,
      }
      // A read already in flight started without this extent; never join it.
      if (workspaceFlight) workspaceFlight.joinable = false
      const selection =
        lastWorkspaceRead?.sessionId === sessionId ? lastWorkspaceRead.selection : undefined
      return get().refreshSessionWorkspace(sessionId, selection)
    },

    loadTranscriptThrough(sessionId, nodeId) {
      const shown = get().activeWorkspace
      if (shown?.tree.session.id !== sessionId || !hasEarlierTranscript(shown)) {
        return Promise.resolve()
      }
      if (shown.transcriptPath.some((entry) => entry.node.id === nodeId)) return Promise.resolve()
      windowTarget = { minEntries: windowTarget.minEntries, includeNodeId: nodeId }
      if (workspaceFlight) workspaceFlight.joinable = false
      const selection =
        lastWorkspaceRead?.sessionId === sessionId ? lastWorkspaceRead.selection : undefined
      return get().refreshSessionWorkspace(sessionId, selection)
    },
  } satisfies Pick<
    SessionState,
    | 'refreshSessionTree'
    | 'refreshSessionWorkspace'
    | 'showSessionWorkspace'
    | 'loadEarlierTranscript'
    | 'loadTranscriptThrough'
  >
}
