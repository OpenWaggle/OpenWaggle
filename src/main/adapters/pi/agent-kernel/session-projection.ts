import type { AgentSession, SessionEntry } from '@mariozechner/pi-coding-agent'
import {
  PI_WAGGLE_TURN_CUSTOM_TYPE,
  parsePiWaggleTurnDetails,
} from '@openwaggle/pi-waggle/protocol'
import { parseJsonUnknown } from '@shared/schema'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { projectionForPiEntry } from './entry-projections'

interface PiSessionSnapshotSource {
  readonly sessionManager: Pick<AgentSession['sessionManager'], 'getEntries' | 'getLeafId'>
}

function parsePiEntryTimestamp(timestamp: string) {
  const parsed = Date.parse(timestamp)
  return Number.isFinite(parsed) ? parsed : Date.now()
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAssistantEntry(entry: SessionEntry): entry is Extract<
  SessionEntry,
  { type: 'message' }
> & {
  readonly message: Extract<
    Extract<SessionEntry, { type: 'message' }>['message'],
    { role: 'assistant' }
  >
} {
  return entry.type === 'message' && entry.message.role === 'assistant'
}

function isTurnCustomMessageEntry(
  entry: SessionEntry,
): entry is Extract<SessionEntry, { type: 'custom_message' }> {
  return entry.type === 'custom_message' && entry.customType === PI_WAGGLE_TURN_CUSTOM_TYPE
}

function turnMetadataFromCustomMessage(input: {
  readonly assistant: Extract<SessionEntry, { type: 'message' }> & {
    readonly message: Extract<
      Extract<SessionEntry, { type: 'message' }>['message'],
      { role: 'assistant' }
    >
  }
  readonly entry: Extract<SessionEntry, { type: 'custom_message' }>
}) {
  const details = parsePiWaggleTurnDetails(input.entry.details)
  if (!details) return null

  return {
    agentIndex: details.agentIndex,
    agentLabel: details.agentLabel,
    agentColor: details.agentColor,
    agentModel: details.agentModel,
    turnNumber: details.turnNumber,
    sessionId: details.runId,
  }
}

function nearestTurnMetadata(input: {
  readonly entry: Extract<SessionEntry, { type: 'message' }> & {
    readonly message: Extract<
      Extract<SessionEntry, { type: 'message' }>['message'],
      { role: 'assistant' }
    >
  }
  readonly entryById: ReadonlyMap<string, SessionEntry>
}) {
  let currentParentId = input.entry.parentId
  while (currentParentId) {
    const parent = input.entryById.get(currentParentId)
    if (!parent) {
      return null
    }
    if (isTurnCustomMessageEntry(parent)) {
      return turnMetadataFromCustomMessage({ assistant: input.entry, entry: parent })
    }
    currentParentId = parent.parentId
  }

  return null
}

function mergeMetadataJsonWithWaggle(rawMetadataJson: string, waggle: unknown) {
  const parsed = parseJsonUnknown(rawMetadataJson)
  const metadata = isRecord(parsed) ? parsed : {}
  return JSON.stringify({ ...metadata, waggle })
}

function projectPiEntry(input: {
  readonly entry: SessionEntry
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly createdOrder: number
  readonly pathDepth: number
}): ProjectedSessionNodeInput {
  const timestampMs = parsePiEntryTimestamp(input.entry.timestamp)
  const projection = projectionForPiEntry(input.entry)
  const waggleMetadata = isAssistantEntry(input.entry)
    ? nearestTurnMetadata({ entry: input.entry, entryById: input.entryById })
    : null

  return {
    id: input.entry.id,
    parentId: input.entry.parentId,
    piEntryType: input.entry.type,
    kind: projection.kind,
    role: projection.role,
    timestampMs,
    contentJson: projection.contentJson,
    metadataJson: waggleMetadata
      ? mergeMetadataJsonWithWaggle(projection.metadataJson, waggleMetadata)
      : projection.metadataJson,
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
        entryById,
        createdOrder: index,
        pathDepth: getPiEntryDepth({ entryId: entry.id, entryById, depthById }),
      }),
    ),
  }
}
