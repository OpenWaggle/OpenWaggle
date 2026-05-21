import type { AgentSession, SessionEntry } from '@mariozechner/pi-coding-agent'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { projectionForPiEntry } from './entry-projections'

interface PiSessionSnapshotSource {
  readonly sessionManager: Pick<AgentSession['sessionManager'], 'getEntries' | 'getLeafId'>
}

function parsePiEntryTimestamp(timestamp: string) {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function projectPiEntry(input: {
  readonly entry: SessionEntry
  readonly createdOrder: number
  readonly pathDepth: number
}): ProjectedSessionNodeInput {
  const timestampMs = parsePiEntryTimestamp(input.entry.timestamp)
  const projection = projectionForPiEntry(input.entry)

  return {
    id: input.entry.id,
    parentId: input.entry.parentId,
    piEntryType: input.entry.type,
    kind: projection.kind,
    role: projection.role,
    timestampMs,
    contentJson: projection.contentJson,
    metadataJson: projection.metadataJson,
    pathDepth: input.pathDepth,
    createdOrder: input.createdOrder,
  }
}

function getPiEntryDepth(input: {
  readonly entryId: string
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly depthById: Map<string, number>
}): number {
  const cached = input.depthById.get(input.entryId)
  if (cached !== undefined) {
    return cached
  }

  const entry = input.entryById.get(input.entryId)
  if (!entry?.parentId) {
    input.depthById.set(input.entryId, 0)
    return 0
  }

  const depth =
    getPiEntryDepth({
      entryId: entry.parentId,
      entryById: input.entryById,
      depthById: input.depthById,
    }) + 1
  input.depthById.set(input.entryId, depth)
  return depth
}

export function projectPiSessionSnapshot(session: PiSessionSnapshotSource) {
  const entries = session.sessionManager.getEntries()
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const depthById = new Map<string, number>()

  return {
    activeNodeId: session.sessionManager.getLeafId(),
    nodes: entries.map((entry, index) =>
      projectPiEntry({
        entry,
        createdOrder: index,
        pathDepth: getPiEntryDepth({ entryId: entry.id, entryById, depthById }),
      }),
    ),
  }
}
