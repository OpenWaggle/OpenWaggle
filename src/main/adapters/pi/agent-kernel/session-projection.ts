import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { parseJsonUnknown } from '@shared/schema'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import { OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE } from '../run-attribution-extension'
import { contextOmittedEntryIds } from './context-edit-omissions'
import { createEntryModelSelection } from './entry-model-selection'
import { projectionForPiEntry } from './entry-projections'
import { type PiEntryNodeIds, piEntryNodeIdsWithPrefix } from './pi-entry-node-ids'
import { findUserInputProjection } from './user-input-projection'
import {
  createWaggleTurnMetadataResolver,
  isUserMessageEntry,
  type PiAssistantMessageEntry,
} from './waggle-turn-metadata'

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

function isAssistantEntry(entry: SessionEntry): entry is PiAssistantMessageEntry {
  return entry.type === 'message' && entry.message.role === 'assistant'
}

function mergeMetadataJsonWithWaggle(rawMetadataJson: string, waggle: unknown) {
  const parsed = parseJsonUnknown(rawMetadataJson)
  const metadata = isRecord(parsed) ? parsed : {}
  return JSON.stringify({ ...metadata, waggle })
}

/** A response a context edit drops from the model's context, such as an attempt Pi retried. */
function mergeMetadataJsonWithContextOmission(rawMetadataJson: string, omitted: boolean) {
  if (!omitted) return rawMetadataJson
  const parsed = parseJsonUnknown(rawMetadataJson)
  return JSON.stringify({ ...(isRecord(parsed) ? parsed : {}), omittedFromContext: true })
}

function mergeMetadataJsonWithDurableText(rawMetadataJson: string, digest: string | null) {
  if (!digest) return rawMetadataJson
  const parsed = parseJsonUnknown(rawMetadataJson)
  const metadata = isRecord(parsed) ? parsed : {}
  return JSON.stringify({ ...metadata, durableTextSha256: digest })
}

/** The Session's model selection when a response was made, which a virtual model routed. */
function mergeMetadataJsonWithSelectedModel(rawMetadataJson: string, selectedModel: string | null) {
  if (!selectedModel) return rawMetadataJson
  const parsed = parseJsonUnknown(rawMetadataJson)
  return JSON.stringify({ ...(isRecord(parsed) ? parsed : {}), selectedModel })
}

function mergeMetadataJsonWithRun(rawMetadataJson: string, runId: string | null) {
  if (!runId) return rawMetadataJson
  const parsed = parseJsonUnknown(rawMetadataJson)
  const metadata = isRecord(parsed) ? parsed : {}
  const existingOpenWaggle = isRecord(metadata.openWaggle) ? metadata.openWaggle : {}
  return JSON.stringify({
    ...metadata,
    openWaggle: { ...existingOpenWaggle, runId },
  })
}

function boundaryRunId(entry: SessionEntry) {
  if (entry.type !== 'custom' || entry.customType !== OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE) {
    return null
  }
  return isRecord(entry.data) && typeof entry.data.runId === 'string' ? entry.data.runId : null
}

function runIdForEntry(input: {
  readonly entryId: string
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly runIdByEntryId: Map<string, string | null>
}): string | null {
  if (input.runIdByEntryId.has(input.entryId)) {
    return input.runIdByEntryId.get(input.entryId) ?? null
  }
  const entry = input.entryById.get(input.entryId)
  if (!entry) return null
  const runId =
    boundaryRunId(entry) ??
    (entry.parentId
      ? runIdForEntry({
          entryId: entry.parentId,
          entryById: input.entryById,
          runIdByEntryId: input.runIdByEntryId,
        })
      : null)
  input.runIdByEntryId.set(input.entryId, runId)
  return runId
}

function userDisplayProjection(entry: SessionEntry, entryById: ReadonlyMap<string, SessionEntry>) {
  return isUserMessageEntry(entry) ? findUserInputProjection(entry.parentId, entryById) : null
}

/** The entry with the ids it names expressed as node ids, for the content the projection keeps. */
function withNodeReferences(entry: SessionEntry, nodeIds: PiEntryNodeIds): SessionEntry {
  return matchBy(entry, 'type')
    .with(
      'compaction',
      (compaction): SessionEntry => ({
        ...compaction,
        firstKeptEntryId: nodeIds.toNodeId(compaction.firstKeptEntryId),
      }),
    )
    .with(
      'branch_summary',
      (summary): SessionEntry => ({
        ...summary,
        fromId: nodeIds.toNodeId(summary.fromId),
      }),
    )
    .with(
      'label',
      (label): SessionEntry => ({ ...label, targetId: nodeIds.toNodeId(label.targetId) }),
    )
    .otherwise((other) => other)
}

function projectPiEntry(input: {
  readonly entry: SessionEntry
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly createdOrder: number
  readonly pathDepth: number
  readonly runId: string | null
  readonly nodeIds: PiEntryNodeIds
  readonly selectedModel: string | null
  readonly omittedFromContext: boolean
  readonly waggleTurnOf: ReturnType<typeof createWaggleTurnMetadataResolver>
}): ProjectedSessionNodeInput {
  const timestampMs = parsePiEntryTimestamp(input.entry.timestamp)
  const displayProjection = userDisplayProjection(input.entry, input.entryById)
  const projection = projectionForPiEntry(withNodeReferences(input.entry, input.nodeIds), {
    ...(displayProjection ? { userDisplayParts: displayProjection.parts } : {}),
  })
  const waggleMetadata = isAssistantEntry(input.entry) ? input.waggleTurnOf(input.entry) : null

  return {
    id: input.nodeIds.toNodeId(input.entry.id),
    parentId: input.entry.parentId === null ? null : input.nodeIds.toNodeId(input.entry.parentId),
    piEntryType: input.entry.type,
    kind: projection.kind,
    role: projection.role,
    timestampMs,
    contentJson: projection.contentJson,
    metadataJson: mergeMetadataJsonWithRun(
      mergeMetadataJsonWithSelectedModel(
        mergeMetadataJsonWithDurableText(
          mergeMetadataJsonWithContextOmission(
            waggleMetadata
              ? mergeMetadataJsonWithWaggle(projection.metadataJson, waggleMetadata)
              : projection.metadataJson,
            input.omittedFromContext,
          ),
          displayProjection?.durableTextSha256 ?? null,
        ),
        isAssistantEntry(input.entry) ? input.selectedModel : null,
      ),
      input.runId,
    ),
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

/**
 * `nodeIds` maps entry ids to the Session's node ids; a discovered Pi session keys them under a
 * per-Session prefix (ADR 0051). Sessions OpenWaggle created use their entry ids unchanged.
 */
export function projectPiSessionSnapshot(
  session: PiSessionSnapshotSource,
  nodeIds: PiEntryNodeIds = piEntryNodeIdsWithPrefix(undefined),
) {
  const entries = session.sessionManager.getEntries()
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const depthById = new Map<string, number>()
  const runIdByEntryId = new Map<string, string | null>()
  const leafId = session.sessionManager.getLeafId()
  const selectedModelOf = createEntryModelSelection(entryById)
  const omittedEntryIds = contextOmittedEntryIds(entries, entryById, leafId)
  const waggleTurnOf = createWaggleTurnMetadataResolver(entries, entryById)

  return {
    activeNodeId: leafId === null ? null : nodeIds.toNodeId(leafId),
    nodes: entries.map((entry, index) =>
      projectPiEntry({
        entry,
        entryById,
        createdOrder: index,
        pathDepth: getPiEntryDepth({ entryId: entry.id, entryById, depthById }),
        runId: runIdForEntry({ entryId: entry.id, entryById, runIdByEntryId }),
        nodeIds,
        selectedModel: selectedModelOf(entry.parentId),
        omittedFromContext: omittedEntryIds.has(entry.id),
        waggleTurnOf,
      }),
    ),
  }
}
