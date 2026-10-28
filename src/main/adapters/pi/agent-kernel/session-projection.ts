import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import { parseJsonUnknown } from '@shared/schema'
import type { MessageScheduledTaskOrigin } from '@shared/types/agent'
import type { ProjectedSessionNodeInput } from '../../../ports/session-repository'
import type { PiProjectionBase } from '../../../store/session-details/pi-projection-base'
import { markRetainedSnapshotNode } from '../../../store/session-details/retained-snapshot-nodes'
import { OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE } from '../run-attribution-extension'
import { contextOmittedEntryIds } from './context-edit-omissions'
import { createEntryModelSelection } from './entry-model-selection'
import { PI_ENTRY_PROJECTION_VERSION } from './entry-projection-version'
import { projectionForPiEntry } from './entry-projections'
import { type PiEntryNodeIds, piEntryNodeIdsWithPrefix } from './pi-entry-node-ids'
import { previouslyOmittedEntryIds, retainedEntryCount } from './projection-base-entries'
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

/** The Scheduled task whose run sent a user message, as the Host recorded it with the message. */
function mergeMetadataJsonWithScheduledTask(
  rawMetadataJson: string,
  scheduledTask: MessageScheduledTaskOrigin | null,
) {
  if (!scheduledTask) return rawMetadataJson
  const parsed = parseJsonUnknown(rawMetadataJson)
  return JSON.stringify({ ...(isRecord(parsed) ? parsed : {}), scheduledTask })
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

interface PiEntryProjectionInput {
  readonly entry: SessionEntry
  readonly entryById: ReadonlyMap<string, SessionEntry>
  readonly createdOrder: number
  readonly pathDepth: number
  readonly runId: string | null
  readonly nodeIds: PiEntryNodeIds
  readonly selectedModel: string | null
  readonly omittedFromContext: boolean
  readonly waggleTurnOf: ReturnType<typeof createWaggleTurnMetadataResolver>
}

function projectPiEntry(input: PiEntryProjectionInput): ProjectedSessionNodeInput {
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
        mergeMetadataJsonWithScheduledTask(
          mergeMetadataJsonWithDurableText(
            mergeMetadataJsonWithContextOmission(
              waggleMetadata
                ? mergeMetadataJsonWithWaggle(projection.metadataJson, waggleMetadata)
                : projection.metadataJson,
              input.omittedFromContext,
            ),
            displayProjection?.durableTextSha256 ?? null,
          ),
          displayProjection?.scheduledTask ?? null,
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
 * An entry the Session's current projection already holds, projected only if its content is read
 * (D6). Its kind and role are the ones it was stored with; everything else an entry's projection
 * depends on (its own bytes, its ancestors, whether a context edit drops it) is as it was then.
 */
function retainedPiEntryNode(
  input: PiEntryProjectionInput,
  stored: Pick<ProjectedSessionNodeInput, 'kind' | 'role'>,
  revision: number,
): ProjectedSessionNodeInput {
  let projected: ProjectedSessionNodeInput | undefined
  const full = () => {
    projected ??= projectPiEntry(input)
    return projected
  }
  return markRetainedSnapshotNode(
    {
      id: input.nodeIds.toNodeId(input.entry.id),
      parentId: input.entry.parentId === null ? null : input.nodeIds.toNodeId(input.entry.parentId),
      piEntryType: input.entry.type,
      kind: stored.kind,
      role: stored.role,
      timestampMs: parsePiEntryTimestamp(input.entry.timestamp),
      get contentJson() {
        return full().contentJson
      },
      get metadataJson() {
        return full().metadataJson
      },
      pathDepth: input.pathDepth,
      createdOrder: input.createdOrder,
    },
    revision,
  )
}

/**
 * `nodeIds` maps entry ids to the Session's node ids; a discovered Pi session keys them under a
 * per-Session prefix (ADR 0051). Sessions OpenWaggle created use their entry ids unchanged.
 *
 * With `base`, the Session's current projection, the entries it already holds are kept rather
 * than projected again (D6): only Pi's appended entries, and earlier ones a later context edit
 * changed, are projected now. The snapshot is the same as a full projection; a kept node's content
 * is computed only if read, and snapshot persistence leaves its stored row as it is. A base stored
 * by another entry-projection version is not used, so a projection change reaches stored rows.
 */
export function projectPiSessionSnapshot(
  session: PiSessionSnapshotSource,
  nodeIds: PiEntryNodeIds = piEntryNodeIdsWithPrefix(undefined),
  projectionBase: PiProjectionBase | null = null,
) {
  const base =
    projectionBase?.tail.projectionVersion === PI_ENTRY_PROJECTION_VERSION ? projectionBase : null
  const entries = session.sessionManager.getEntries()
  const entryById = new Map(entries.map((entry) => [entry.id, entry]))
  const depthById = new Map<string, number>()
  const runIdByEntryId = new Map<string, string | null>()
  const leafId = session.sessionManager.getLeafId()
  const selectedModelOf = createEntryModelSelection(entryById)
  const omittedEntryIds = contextOmittedEntryIds(entries, entryById, leafId)
  const waggleTurnOf = createWaggleTurnMetadataResolver(entries, entryById)
  const keptCount = base ? retainedEntryCount(entries, base, nodeIds) : 0
  const previouslyOmitted =
    base && keptCount > 0 ? previouslyOmittedEntryIds(entries, keptCount, base, nodeIds) : null

  return {
    activeNodeId: leafId === null ? null : nodeIds.toNodeId(leafId),
    piProjection: { version: PI_ENTRY_PROJECTION_VERSION },
    nodes: entries.map((entry, index) => {
      const input: PiEntryProjectionInput = {
        entry,
        entryById,
        createdOrder: index,
        pathDepth: getPiEntryDepth({ entryId: entry.id, entryById, depthById }),
        runId: runIdForEntry({ entryId: entry.id, entryById, runIdByEntryId }),
        nodeIds,
        selectedModel: selectedModelOf(entry.parentId),
        omittedFromContext: omittedEntryIds.has(entry.id),
        waggleTurnOf,
      }
      const stored =
        base && previouslyOmitted && index < keptCount
          ? base.storedShapeByNodeId.get(nodeIds.toNodeId(entry.id))
          : undefined
      if (!base || !stored || previouslyOmitted?.has(entry.id) !== input.omittedFromContext) {
        return projectPiEntry(input)
      }
      return retainedPiEntryNode(input, stored, base.revision)
    }),
  }
}
