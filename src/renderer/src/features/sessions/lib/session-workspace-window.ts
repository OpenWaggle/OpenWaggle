import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  SessionTranscriptEntry,
  SessionTranscriptNode,
  SessionWorkspace,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import type { SessionWorkspaceRequest } from '@shared/types/session-transcript-window'

/**
 * The transcript window the desktop window reads (ADR 0036 bounds the transferred rows as well as
 * the mounted ones; v1 performance B5).
 *
 * A workspace read returns the newest part of the selected path, and leaves out the content of
 * entries this window already holds while the Session's nodes were only appended to. Reaching the
 * top of the loaded part reads the next page; a restored reading position deep in history reads a
 * window that reaches it.
 */

/** Path entries in one page: well above the 160 rows the transcript mounts at once. */
export const TRANSCRIPT_WINDOW_PAGE_ENTRIES = 200
/** Most node ids one read says it holds; past this the oldest are simply sent again. */
const MAX_CACHED_NODE_IDS = 5_000
/** Sessions whose loaded transcript nodes are kept for a quick return. */
const MAX_CACHED_SESSIONS = 4

interface SessionNodeCache {
  readonly nodeMutationRevision: number
  readonly nodes: ReadonlyMap<string, SessionTranscriptNode>
}

const nodeCaches = new Map<string, SessionNodeCache>()

/** Forgets every Session's held transcript nodes (tests, and a Host resync). */
export function clearTranscriptNodeCaches() {
  nodeCaches.clear()
}

export function forgetTranscriptNodeCache(sessionId: SessionId) {
  nodeCaches.delete(String(sessionId))
}

function rememberNodes(sessionId: SessionId, workspace: SessionWorkspace) {
  const key = String(sessionId)
  if (workspace.nodeMutationRevision === undefined) {
    nodeCaches.delete(key)
    return
  }
  const previous = nodeCaches.get(key)
  const nodes = new Map(
    previous?.nodeMutationRevision === workspace.nodeMutationRevision ? previous.nodes : [],
  )
  for (const entry of workspace.transcriptPath) nodes.set(String(entry.node.id), entry.node)
  nodeCaches.delete(key)
  nodeCaches.set(key, { nodeMutationRevision: workspace.nodeMutationRevision, nodes })
  while (nodeCaches.size > MAX_CACHED_SESSIONS) {
    const oldest = nodeCaches.keys().next().value
    if (oldest === undefined) break
    nodeCaches.delete(oldest)
  }
}

export function sameWorkspaceSelection(
  left: SessionWorkspaceSelection | undefined,
  right: SessionWorkspaceSelection | undefined,
) {
  return (
    String(left?.branchId ?? '') === String(right?.branchId ?? '') &&
    String(left?.nodeId ?? '') === String(right?.nodeId ?? '')
  )
}

/** How much of the path a read should reach, beyond its newest page. */
export interface TranscriptWindowTarget {
  readonly minEntries: number
  readonly includeNodeId: SessionNodeId | null
}

export const NEWEST_TRANSCRIPT_WINDOW: TranscriptWindowTarget = {
  minEntries: TRANSCRIPT_WINDOW_PAGE_ENTRIES,
  includeNodeId: null,
}

/**
 * The read for a Session's workspace. `loaded` is the window this view shows for the same
 * selection, if any: the read keeps it (from its first entry to the newest), so a refresh after a
 * Run appends the new entries instead of dropping what the reader scrolled back to.
 */
export function transcriptWindowRequest(input: {
  readonly sessionId: SessionId
  readonly loaded: SessionWorkspace | null
  readonly target: TranscriptWindowTarget
}): SessionWorkspaceRequest {
  const firstLoaded = input.loaded?.transcriptPath[0]?.node.id ?? null
  const includeNodeId = input.target.includeNodeId ?? firstLoaded
  const cache = nodeCaches.get(String(input.sessionId))
  const cachedIds = cache
    ? [...cache.nodes.values()].map((node) => node.id).slice(-MAX_CACHED_NODE_IDS)
    : []
  return {
    window: {
      minEntries: Math.max(TRANSCRIPT_WINDOW_PAGE_ENTRIES, input.target.minEntries),
      ...(includeNodeId ? { includeNodeId } : {}),
    },
    ...(cache && cachedIds.length > 0
      ? {
          cached: {
            nodeMutationRevision: cache.nodeMutationRevision,
            nodeIds: cachedIds,
          },
        }
      : {}),
  }
}

function restoredEntry(
  entry: SessionTranscriptEntry,
  cache: SessionNodeCache | undefined,
): SessionTranscriptEntry | null {
  if (!entry.contentOmitted) return entry
  const held = cache?.nodes.get(String(entry.node.id))
  if (!held) return null
  const { contentOmitted: _omitted, ...rest } = entry
  return { ...rest, node: held }
}

/**
 * The workspace with every omitted entry's content put back from the held nodes, or null when
 * one is missing (the caller then reads again without naming held nodes). Held node objects keep
 * their identity, so unchanged messages do not re-render.
 */
export function restoreTranscriptWindow(
  sessionId: SessionId,
  workspace: SessionWorkspace,
): SessionWorkspace | null {
  const cache = nodeCaches.get(String(sessionId))
  const transcriptPath: SessionTranscriptEntry[] = []
  for (const entry of workspace.transcriptPath) {
    const restored = restoredEntry(entry, cache)
    if (!restored) return null
    transcriptPath.push(restored)
  }
  const restoredWorkspace = { ...workspace, transcriptPath }
  rememberNodes(sessionId, restoredWorkspace)
  return restoredWorkspace
}

/** Whether the Host holds entries of the selected path before the loaded window. */
export function hasEarlierTranscript(workspace: SessionWorkspace | null) {
  return (workspace?.transcriptWindow?.startIndex ?? 0) > 0
}
