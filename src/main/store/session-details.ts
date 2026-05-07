import * as SqlClient from '@effect/sql/SqlClient'
import { Schema, type SchemaType, safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema, waggleMetadataSchema } from '@shared/schemas/waggle'
import type { Message, MessagePart } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import type { SessionDetail, SessionNode, SessionSummary } from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import type {
  PersistSessionSnapshotInput,
  ProjectedSessionNodeInput,
} from '../ports/session-repository'
import { buildPiWorkingContextPath } from './session-working-context'
import { runStoreEffect } from './store-runtime'

const logger = createLogger('session-details')

const EMPTY_INDEX = 0
const MAIN_BRANCH_NAME = 'main'
const EXPANDED_NODE_IDS_DEFAULT_JSON = '[]'
const EXPANDED_NODE_IDS_UNTOUCHED = 0
const TREE_SIDEBAR_EXPANDED = 0
const DEFAULT_BRANCH_UI_STATE_JSON = '{}'
const MESSAGE_ENTRY_TYPE = 'message'
const TOOL_RESULT_KIND = 'tool_result'
const STANDARD_FUTURE_MODE = 'standard'
const WAGGLE_FUTURE_MODE = 'waggle'
const BRANCH_NAME_TRUNCATE_LENGTH = 48

interface SessionRow {
  readonly id: string
  readonly pi_session_id: string
  readonly pi_session_file: string | null
  readonly project_path: string | null
  readonly title: string
  readonly archived: number
  readonly waggle_config_json: string | null
  readonly created_at: number
  readonly updated_at: number
  readonly last_active_node_id: string | null
  readonly last_active_branch_id: string | null
}

interface SessionSummaryRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly created_at: number
  readonly updated_at: number
  readonly message_count: number
}

interface SessionBranchRow {
  readonly id: string
  readonly session_id: string
  readonly source_node_id: string | null
  readonly head_node_id: string | null
  readonly name: string
  readonly is_main: number
  readonly archived_at: number | null
  readonly created_at: number
  readonly updated_at: number
}

interface SessionBranchStateRow {
  readonly branch_id: string
  readonly future_mode: 'standard' | 'waggle'
  readonly waggle_preset_id: string | null
  readonly waggle_config_json: string | null
  readonly last_active_at: number
  readonly ui_state_json: string
}

interface SessionActiveRunRow {
  readonly run_id: string
  readonly session_id: string
  readonly branch_id: string
  readonly run_mode: string
  readonly status: string
  readonly runtime_json: string
  readonly updated_at: number
}

export interface SessionNodeRow {
  readonly id: string
  readonly session_id: string
  readonly parent_id: string | null
  readonly pi_entry_type: string
  readonly kind: SessionNode['kind']
  readonly role: 'user' | 'assistant' | 'system' | null
  readonly timestamp_ms: number
  readonly content_json: string
  readonly metadata_json: string
  readonly branch_hint_id: string | null
  readonly path_depth: number
  readonly created_order: number
}

const sessionJsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.mutable(Schema.Array(sessionJsonValueSchema)),
    Schema.mutable(Schema.Record({ key: Schema.String, value: sessionJsonValueSchema })),
  ),
)

const sessionJsonObjectSchema = Schema.mutable(
  Schema.Record({ key: Schema.String, value: sessionJsonValueSchema }),
)

const toolCallRequestSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: sessionJsonObjectSchema,
  state: Schema.optional(Schema.Literal('input-complete')),
})

const toolCallResultSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  args: sessionJsonObjectSchema,
  result: sessionJsonValueSchema,
  isError: Schema.Boolean,
  duration: Schema.Number,
  details: Schema.optional(sessionJsonValueSchema),
})

const messagePartSchema = Schema.Union(
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('reasoning'), text: Schema.String }),
  Schema.Struct({ type: Schema.Literal('thinking'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('attachment'),
    attachment: Schema.Struct({
      id: Schema.String,
      kind: Schema.Literal('text', 'image', 'pdf'),
      origin: Schema.optional(Schema.Literal('user-file', 'auto-paste-text')),
      name: Schema.String,
      path: Schema.String,
      mimeType: Schema.String,
      sizeBytes: Schema.Number,
      extractedText: Schema.String,
    }),
  }),
  Schema.Struct({ type: Schema.Literal('tool-call'), toolCall: toolCallRequestSchema }),
  Schema.Struct({ type: Schema.Literal('tool-result'), toolResult: toolCallResultSchema }),
)

const messageMetadataSchema = Schema.Struct({
  waggle: Schema.optional(waggleMetadataSchema),
})

const messageNodeContentSchema = Schema.Struct({
  parts: Schema.mutable(Schema.Array(messagePartSchema)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
})

type ParsedPart = SchemaType<typeof messagePartSchema>

export interface UpdateSessionRuntimeInput {
  readonly sessionId: SessionId
  readonly piSessionId?: string
  readonly piSessionFile?: string
}

function mainBranchId(sessionId: string): string {
  return `${sessionId}:${MAIN_BRANCH_NAME}`
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJsonValue(raw: string | null): unknown {
  if (raw === null) {
    return undefined
  }
  return JSON.parse(raw)
}

function normalizeModelId(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed) {
    return trimmed
  }
  return undefined
}

function hydrateWaggleConfig(raw: unknown): WaggleConfig | undefined {
  if (raw === undefined) {
    return undefined
  }

  const parsed = safeDecodeUnknown(waggleConfigSchema, raw)
  if (!parsed.success) {
    return undefined
  }

  return {
    ...parsed.data,
    agents: [
      {
        ...parsed.data.agents[0],
        model: SupportedModelId(parsed.data.agents[0].model),
      },
      {
        ...parsed.data.agents[1],
        model: SupportedModelId(parsed.data.agents[1].model),
      },
    ],
  }
}

function transformPart(part: ParsedPart): MessagePart {
  return chooseBy(part, 'type')
    .case('text', (value): MessagePart => ({ type: 'text', text: value.text }))
    .case('reasoning', (value): MessagePart => ({ type: 'reasoning', text: value.text }))
    .case('thinking', (value): MessagePart => ({ type: 'reasoning', text: value.text }))
    .case(
      'attachment',
      (value): MessagePart => ({
        type: 'attachment',
        attachment: value.attachment,
      }),
    )
    .case(
      'tool-call',
      (value): MessagePart => ({
        type: 'tool-call',
        toolCall: {
          id: ToolCallId(value.toolCall.id),
          name: value.toolCall.name,
          args: value.toolCall.args,
          state: value.toolCall.state,
        },
      }),
    )
    .case(
      'tool-result',
      (value): MessagePart => ({
        type: 'tool-result',
        toolResult: {
          id: ToolCallId(value.toolResult.id),
          name: value.toolResult.name,
          args: value.toolResult.args,
          result: value.toolResult.result,
          isError: value.toolResult.isError,
          duration: value.toolResult.duration,
          details: value.toolResult.details,
        },
      }),
    )
    .assertComplete()
}

function hydrateSessionSummary(row: SessionSummaryRow): SessionSummary {
  return {
    id: SessionId(row.id),
    title: row.title,
    projectPath: row.project_path,
    messageCount: row.message_count,
    archived: row.archived === 1 ? true : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function hydrateSessionMessage(row: SessionNodeRow) {
  const parsedContent = safeDecodeUnknown(
    messageNodeContentSchema,
    parseJsonValue(row.content_json),
  )
  if (!parsedContent.success) {
    throw new Error(
      `Invalid message node content for ${row.id}: ${parsedContent.issues.join('; ')}`,
    )
  }

  const modelId = parsedContent.data.model ? normalizeModelId(parsedContent.data.model) : undefined

  const parsedMetadata = safeDecodeUnknown(
    messageMetadataSchema,
    parseJsonValue(row.metadata_json) ?? {},
  )

  return {
    id: MessageId(row.id),
    role: row.role ?? 'assistant',
    parts: parsedContent.data.parts.map(transformPart),
    model: modelId ? SupportedModelId(modelId) : undefined,
    metadata: parsedMetadata.success
      ? parsedMetadata.data
        ? {
            ...parsedMetadata.data,
            waggle: parsedMetadata.data.waggle
              ? {
                  ...parsedMetadata.data.waggle,
                  agentModel: parsedMetadata.data.waggle.agentModel
                    ? SupportedModelId(parsedMetadata.data.waggle.agentModel)
                    : undefined,
                }
              : undefined,
          }
        : undefined
      : undefined,
    createdAt: row.timestamp_ms,
  }
}

function hydrateSessionDetail(
  sessionRow: SessionRow,
  nodeRows: readonly SessionNodeRow[],
): SessionDetail | null {
  try {
    const messages = hydrateSessionMessages(
      getActivePathRows(sessionRow.last_active_node_id, nodeRows),
    )

    return {
      id: SessionId(sessionRow.id),
      title: sessionRow.title,
      projectPath: sessionRow.project_path,
      piSessionId: sessionRow.pi_session_id,
      piSessionFile: sessionRow.pi_session_file ?? undefined,
      messages,
      waggleConfig: hydrateWaggleConfig(parseJsonValue(sessionRow.waggle_config_json)),
      archived: sessionRow.archived === 1 ? true : undefined,
      createdAt: sessionRow.created_at,
      updatedAt: sessionRow.updated_at,
    }
  } catch (error) {
    logger.warn('Failed to hydrate session-backed session', {
      sessionId: sessionRow.id,
      error: describeError(error),
    })
    return null
  }
}

function getActivePathRows(
  activeNodeId: string | null,
  nodeRows: readonly SessionNodeRow[],
): readonly SessionNodeRow[] {
  return buildPiWorkingContextPath(activeNodeId, nodeRows, {
    getId: (row) => row.id,
    getParentId: (row) => row.parent_id,
    getKind: (row) => row.kind,
    getContentJson: (row) => row.content_json,
  })
}

function getStringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) {
    return null
  }

  const field = value[key]
  return typeof field === 'string' && field.trim().length > 0 ? field : null
}

function getNumberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) {
    return null
  }

  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

export function hydrateStructuralSessionMessage(row: SessionNodeRow): Message | null {
  const content = parseJsonValue(row.content_json)
  const summary = getStringField(content, 'summary')
  if (!summary) {
    return null
  }

  if (row.kind === 'branch_summary') {
    return {
      id: MessageId(row.id),
      role: 'assistant',
      parts: [{ type: 'text', text: `Branch summary\n\n${summary}` }],
      metadata: { branchSummary: { summary } },
      createdAt: row.timestamp_ms,
    }
  }

  if (row.kind === 'compaction_summary') {
    const tokensBefore = getNumberField(content, 'tokensBefore')
    return {
      id: MessageId(row.id),
      role: 'assistant',
      parts: [{ type: 'text', text: `Compaction summary\n\n${summary}` }],
      ...(tokensBefore !== null
        ? { metadata: { compactionSummary: { summary, tokensBefore } } }
        : {}),
      createdAt: row.timestamp_ms,
    }
  }

  return null
}

function hydrateSessionMessages(nodeRows: readonly SessionNodeRow[]): Message[] {
  const messages: Message[] = []

  for (const row of nodeRows) {
    if (row.kind === 'branch_summary' || row.kind === 'compaction_summary') {
      const structuralMessage = hydrateStructuralSessionMessage(row)
      if (structuralMessage) {
        messages.push(structuralMessage)
      }
      continue
    }

    if (row.kind === TOOL_RESULT_KIND) {
      messages.push(hydrateSessionMessage(row))
      continue
    }

    if (
      row.pi_entry_type !== MESSAGE_ENTRY_TYPE &&
      row.kind !== 'user_message' &&
      row.kind !== 'assistant_message'
    ) {
      continue
    }

    if (row.role !== null) {
      messages.push(hydrateSessionMessage(row))
    }
  }

  return messages
}

interface DerivedSessionBranch {
  readonly id: string
  readonly sourceNodeId: string | null
  readonly headNodeId: string | null
  readonly name: string
  readonly isMain: boolean
  readonly archivedAt: number | null
  readonly createdAt: number
}

function uniqueHeadIds(headIds: readonly (string | null)[]): string[] {
  const result: string[] = []
  for (const headId of headIds) {
    if (!headId || result.includes(headId)) {
      continue
    }
    result.push(headId)
  }
  return result
}

function createdOrderByNodeId(nodes: readonly ProjectedSessionNodeInput[]): Map<string, number> {
  return new Map(nodes.map((node) => [node.id, node.createdOrder]))
}

function buildChildCounts(nodes: readonly ProjectedSessionNodeInput[]): Map<string, number> {
  const childCounts = new Map<string, number>()
  for (const node of nodes) {
    if (!node.parentId) {
      continue
    }
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1)
  }
  return childCounts
}

function getPathIds(
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  headId: string | null,
): string[] {
  if (!headId) {
    return []
  }

  const path: string[] = []
  let currentId: string | null = headId
  while (currentId) {
    const node = nodeById.get(currentId)
    if (!node) {
      break
    }
    path.unshift(node.id)
    currentId = node.parentId
  }
  return path
}

function isDescendantOrSame(
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  candidateId: string | null,
  ancestorId: string | null,
): boolean {
  if (!candidateId || !ancestorId) {
    return false
  }

  let currentId: string | null = candidateId
  while (currentId) {
    if (currentId === ancestorId) {
      return true
    }
    currentId = nodeById.get(currentId)?.parentId ?? null
  }
  return false
}

function findEarliestLeafDescendant(input: {
  readonly leafIds: readonly string[]
  readonly existingHeadId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly orderById: ReadonlyMap<string, number>
}): string | null {
  const descendants = input.leafIds.filter((leafId) =>
    isDescendantOrSame(input.nodeById, leafId, input.existingHeadId),
  )
  if (descendants.length === 0) {
    return input.existingHeadId && input.nodeById.has(input.existingHeadId)
      ? input.existingHeadId
      : null
  }

  descendants.sort(
    (left, right) => (input.orderById.get(left) ?? 0) - (input.orderById.get(right) ?? 0),
  )
  return descendants[0] ?? null
}

function findBranchSourceNodeId(
  pathIds: readonly string[],
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  childCounts: ReadonlyMap<string, number>,
): string | null {
  for (const nodeId of pathIds) {
    const node = nodeById.get(nodeId)
    if (!node?.parentId) {
      continue
    }
    if ((childCounts.get(node.parentId) ?? 0) > 1) {
      return node.parentId
    }
  }
  return null
}

function findBranchStartNodeId(
  pathIds: readonly string[],
  nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>,
  childCounts: ReadonlyMap<string, number>,
): string | null {
  for (const nodeId of pathIds) {
    const node = nodeById.get(nodeId)
    if (!node?.parentId) {
      continue
    }
    if ((childCounts.get(node.parentId) ?? 0) > 1) {
      return nodeId
    }
  }
  return pathIds[pathIds.length - 1] ?? null
}

function parseMessageTextPreview(raw: string): string | null {
  const parsed = parseJsonValue(raw)
  if (!isRecord(parsed)) {
    return null
  }

  const parts = parsed.parts
  if (!Array.isArray(parts)) {
    return null
  }

  for (const part of parts) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      const trimmed = part.text.trim()
      if (trimmed) {
        return trimmed
      }
    }
  }
  return null
}

function compactBranchName(text: string, fallback: string): string {
  const words = text.replace(/\s+/g, ' ').trim()
  if (!words) {
    return fallback
  }
  return words.length > BRANCH_NAME_TRUNCATE_LENGTH
    ? `${words.slice(0, BRANCH_NAME_TRUNCATE_LENGTH)}...`
    : words
}

function deriveNewBranchName(input: {
  readonly sourceNodeId: string | null
  readonly headNodeId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly fallback: string
}): string {
  const sourceNode = input.sourceNodeId ? input.nodeById.get(input.sourceNodeId) : null
  const headNode = input.headNodeId ? input.nodeById.get(input.headNodeId) : null
  const sourcePreview = sourceNode ? parseMessageTextPreview(sourceNode.contentJson) : null
  if (sourcePreview) {
    return compactBranchName(sourcePreview, input.fallback)
  }

  const headPreview = headNode ? parseMessageTextPreview(headNode.contentJson) : null
  return headPreview ? compactBranchName(headPreview, input.fallback) : input.fallback
}

function findExistingBranchForDerivedPath(input: {
  readonly existingBranches: readonly SessionBranchRow[]
  readonly branchStartNodeId: string | null
  readonly headNodeId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly childCounts: ReadonlyMap<string, number>
}): SessionBranchRow | null {
  for (const branch of input.existingBranches) {
    if (branch.is_main === 1) {
      continue
    }

    if (isDescendantOrSame(input.nodeById, input.headNodeId, branch.head_node_id)) {
      return branch
    }

    const existingPath = getPathIds(input.nodeById, branch.head_node_id)
    const existingStartNodeId = findBranchStartNodeId(
      existingPath,
      input.nodeById,
      input.childCounts,
    )
    if (existingStartNodeId && existingStartNodeId === input.branchStartNodeId) {
      return branch
    }
  }

  return null
}

function resolveMainHeadId(input: {
  readonly activeHeadId: string | null
  readonly leafIds: readonly string[]
  readonly previousMainHeadId: string | null
  readonly nodeById: ReadonlyMap<string, ProjectedSessionNodeInput>
  readonly orderById: ReadonlyMap<string, number>
}): string | null {
  if (!input.previousMainHeadId) {
    const heads = uniqueHeadIds([input.activeHeadId, ...input.leafIds])
    heads.sort(
      (left, right) => (input.orderById.get(left) ?? 0) - (input.orderById.get(right) ?? 0),
    )
    return heads[0] ?? null
  }

  if (isDescendantOrSame(input.nodeById, input.activeHeadId, input.previousMainHeadId)) {
    return input.activeHeadId
  }

  return findEarliestLeafDescendant({
    leafIds: input.leafIds,
    existingHeadId: input.previousMainHeadId,
    nodeById: input.nodeById,
    orderById: input.orderById,
  })
}

function deriveSessionBranches(input: {
  readonly sessionId: string
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly activeNodeId: string | null
  readonly existingBranches: readonly SessionBranchRow[]
}): {
  readonly branches: readonly DerivedSessionBranch[]
  readonly activeBranchId: string
  readonly activeNodeId: string | null
} {
  const fallbackHeadId = input.nodes[input.nodes.length - 1]?.id ?? null
  const activeHeadId = input.activeNodeId ?? fallbackHeadId
  const childCounts = buildChildCounts(input.nodes)
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const orderById = createdOrderByNodeId(input.nodes)
  const leafIds = input.nodes
    .filter((node) => (childCounts.get(node.id) ?? 0) === 0)
    .map((node) => node.id)
  const mainBranchRow = input.existingBranches.find((branch) => branch.is_main === 1)
  const mainId = mainBranchId(input.sessionId)

  if (input.nodes.length === 0) {
    return {
      activeBranchId: mainId,
      activeNodeId: null,
      branches: [
        {
          id: mainId,
          sourceNodeId: null,
          headNodeId: null,
          name: MAIN_BRANCH_NAME,
          isMain: true,
          archivedAt: mainBranchRow?.archived_at ?? null,
          createdAt: mainBranchRow?.created_at ?? Date.now(),
        },
      ],
    }
  }

  const mainHeadId = resolveMainHeadId({
    activeHeadId,
    leafIds,
    previousMainHeadId: mainBranchRow?.head_node_id ?? null,
    nodeById,
    orderById,
  })
  const headIds = uniqueHeadIds([mainHeadId, activeHeadId, ...leafIds])
  const branches = headIds.map((headId, index) => {
    const isMain = headId === mainHeadId
    const pathIds = getPathIds(nodeById, headId)
    const sourceNodeId = isMain ? null : findBranchSourceNodeId(pathIds, nodeById, childCounts)
    const branchStartNodeId = isMain ? null : findBranchStartNodeId(pathIds, nodeById, childCounts)
    const existingBranch = isMain
      ? mainBranchRow
      : findExistingBranchForDerivedPath({
          existingBranches: input.existingBranches,
          branchStartNodeId,
          headNodeId: headId,
          nodeById,
          childCounts,
        })
    const id = isMain
      ? mainId
      : (existingBranch?.id ?? `${input.sessionId}:branch:${branchStartNodeId ?? headId}`)
    const fallback = `Branch ${index + 1}`

    return {
      id,
      sourceNodeId,
      headNodeId: headId,
      name: isMain
        ? MAIN_BRANCH_NAME
        : (existingBranch?.name ??
          deriveNewBranchName({ sourceNodeId, headNodeId: headId, nodeById, fallback })),
      isMain,
      archivedAt: existingBranch?.archived_at ?? null,
      createdAt: existingBranch?.created_at ?? Date.now(),
    }
  })

  const activeBranch =
    branches.find(
      (branch) => branch.headNodeId === activeHeadId && isActiveSelectableBranch(branch),
    ) ??
    branches.find((branch) => branch.id === mainId && isActiveSelectableBranch(branch)) ??
    branches.find(isActiveSelectableBranch) ??
    branches[EMPTY_INDEX]

  return {
    branches,
    activeBranchId: activeBranch?.id ?? mainId,
    activeNodeId: activeBranch?.headNodeId ?? null,
  }
}

function getBranchStateValue(input: {
  readonly branch: DerivedSessionBranch
  readonly activeBranchId: string
  readonly waggleConfig: WaggleConfig | undefined
  readonly existingState: SessionBranchStateRow | undefined
  readonly now: number
}): {
  readonly futureMode: 'standard' | 'waggle'
  readonly wagglePresetId: string | null
  readonly waggleConfigJson: string | null
  readonly lastActiveAt: number
  readonly uiStateJson: string
} {
  if (input.branch.id === input.activeBranchId && input.waggleConfig) {
    return {
      futureMode: WAGGLE_FUTURE_MODE,
      wagglePresetId: null,
      waggleConfigJson: JSON.stringify(input.waggleConfig),
      lastActiveAt: input.now,
      uiStateJson: input.existingState?.ui_state_json ?? DEFAULT_BRANCH_UI_STATE_JSON,
    }
  }

  return {
    futureMode: input.existingState?.future_mode ?? STANDARD_FUTURE_MODE,
    wagglePresetId: input.existingState?.waggle_preset_id ?? null,
    waggleConfigJson: input.existingState?.waggle_config_json ?? null,
    lastActiveAt:
      input.branch.id === input.activeBranchId
        ? input.now
        : (input.existingState?.last_active_at ?? input.now),
    uiStateJson: input.existingState?.ui_state_json ?? DEFAULT_BRANCH_UI_STATE_JSON,
  }
}

function emptyDerivedMainBranch(sessionId: string): DerivedSessionBranch {
  return {
    id: mainBranchId(sessionId),
    sourceNodeId: null,
    headNodeId: null,
    name: MAIN_BRANCH_NAME,
    isMain: true,
    archivedAt: null,
    createdAt: Date.now(),
  }
}

function ensureMainBranch(branches: readonly DerivedSessionBranch[], sessionId: string) {
  return branches.some((branch) => branch.isMain)
    ? branches
    : [
        {
          ...emptyDerivedMainBranch(sessionId),
          headNodeId: branches[EMPTY_INDEX]?.headNodeId ?? null,
        },
        ...branches,
      ]
}

function isActiveSelectableBranch(branch: DerivedSessionBranch): boolean {
  return branch.archivedAt === null
}

function normalizeDerivedBranches(input: {
  readonly branches: readonly DerivedSessionBranch[]
  readonly sessionId: string
  readonly activeBranchId: string
  readonly activeNodeId: string | null
}) {
  const branches = ensureMainBranch(input.branches, input.sessionId)
  const activeBranchId = branches.some(
    (branch) => branch.id === input.activeBranchId && isActiveSelectableBranch(branch),
  )
    ? input.activeBranchId
    : mainBranchId(input.sessionId)
  const activeBranch = branches.find((branch) => branch.id === activeBranchId)
  return { branches, activeBranchId, activeNodeId: activeBranch?.headNodeId ?? null }
}

function deriveSessionBranchesForSnapshot(input: {
  readonly sessionId: string
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly activeNodeId: string | null
  readonly existingBranches: readonly SessionBranchRow[]
}) {
  return normalizeDerivedBranches({
    ...deriveSessionBranches(input),
    sessionId: input.sessionId,
  })
}

function deriveBranchHints(input: {
  readonly branches: readonly DerivedSessionBranch[]
  readonly nodes: readonly ProjectedSessionNodeInput[]
  readonly activeBranchId: string
}): ReadonlyMap<string, string> {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const activeBranch = input.branches.find((branch) => branch.id === input.activeBranchId)
  const activePathIds = new Set(getPathIds(nodeById, activeBranch?.headNodeId ?? null))
  const branchHintByNodeId = new Map<string, string>()

  for (const nodeId of activePathIds) {
    branchHintByNodeId.set(nodeId, input.activeBranchId)
  }

  for (const branch of input.branches) {
    if (branch.id === input.activeBranchId) {
      continue
    }

    const pathIds = getPathIds(nodeById, branch.headNodeId)
    for (const nodeId of pathIds) {
      if (activePathIds.has(nodeId)) {
        continue
      }
      branchHintByNodeId.set(nodeId, branch.id)
    }
  }

  return branchHintByNodeId
}

function isSessionDetail(session: SessionDetail | null): session is SessionDetail {
  return session !== null
}

export async function listSessionSummaries(limit?: number): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const effectiveLimit = limit ?? -1
      const rows = yield* sql<SessionSummaryRow>`
        SELECT
          s.id,
          s.title,
          s.project_path,
          s.archived,
          s.created_at,
          s.updated_at,
          (
            SELECT COUNT(*)
            FROM session_nodes sn
            WHERE sn.session_id = s.id
              AND sn.pi_entry_type = ${MESSAGE_ENTRY_TYPE}
          ) AS message_count
        FROM sessions s
        WHERE s.archived = 0
        ORDER BY s.updated_at DESC
        LIMIT ${effectiveLimit}
      `

      return rows.map(hydrateSessionSummary)
    }),
  )
}

export async function listSessionDetails(limit?: number): Promise<SessionDetail[]> {
  const summaries = await listSessionSummaries(limit)
  const sessions = await Promise.all(summaries.map((summary) => getSessionDetail(summary.id)))
  return sessions.filter(isSessionDetail)
}

export async function listArchivedSessions(): Promise<SessionSummary[]> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<SessionSummaryRow>`
        SELECT
          s.id,
          s.title,
          s.project_path,
          s.archived,
          s.created_at,
          s.updated_at,
          (
            SELECT COUNT(*)
            FROM session_nodes sn
            WHERE sn.session_id = s.id
              AND sn.pi_entry_type = ${MESSAGE_ENTRY_TYPE}
          ) AS message_count
        FROM sessions s
        WHERE s.archived = 1
        ORDER BY s.updated_at DESC
      `

      return rows.map(hydrateSessionSummary)
    }),
  )
}

export async function getSessionDetail(id: SessionId): Promise<SessionDetail | null> {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessionRows = yield* sql<SessionRow>`
        SELECT
          id,
          pi_session_id,
          pi_session_file,
          project_path,
          title,
          archived,
          waggle_config_json,
          created_at,
          updated_at,
          last_active_node_id,
          last_active_branch_id
        FROM sessions
        WHERE id = ${id}
        LIMIT 1
      `

      const sessionRow = sessionRows[EMPTY_INDEX]
      if (!sessionRow) {
        return null
      }

      const nodeRows = yield* sql<SessionNodeRow>`
        SELECT
          id,
          session_id,
          parent_id,
          pi_entry_type,
          kind,
          role,
          timestamp_ms,
          content_json,
          metadata_json,
          branch_hint_id,
          path_depth,
          created_order
        FROM session_nodes
        WHERE session_id = ${id}
        ORDER BY created_order ASC
      `

      return hydrateSessionDetail(sessionRow, nodeRows)
    }),
  )
}

export interface CreateSessionInput {
  readonly projectPath: string
  readonly piSessionId: string
  readonly piSessionFile?: string
}

export async function createSession(input: CreateSessionInput): Promise<SessionDetail> {
  const now = Date.now()
  const id = SessionId(input.piSessionId)
  const sessionId = SessionId(String(id))
  const branchId = mainBranchId(String(sessionId))
  const session: SessionDetail = {
    id,
    title: 'New session',
    projectPath: input.projectPath,
    piSessionId: input.piSessionId,
    piSessionFile: input.piSessionFile,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }

  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO sessions (
              id,
              pi_session_id,
              pi_session_file,
              project_path,
              title,
              archived,
              waggle_config_json,
              created_at,
              updated_at,
              last_active_node_id,
              last_active_branch_id
            )
            VALUES (
              ${sessionId},
              ${input.piSessionId},
              ${input.piSessionFile ?? null},
              ${input.projectPath},
              ${session.title},
              ${0},
              ${null},
              ${now},
              ${now},
              ${null},
              ${branchId}
            )
          `

          yield* sql`
            INSERT INTO session_branches (
              id,
              session_id,
              source_node_id,
              head_node_id,
              name,
              is_main,
              archived_at,
              created_at,
              updated_at
            )
            VALUES (
              ${branchId},
              ${sessionId},
              ${null},
              ${null},
              ${MAIN_BRANCH_NAME},
              ${1},
              ${null},
              ${now},
              ${now}
            )
          `

          yield* sql`
            INSERT INTO session_branch_state (
              branch_id,
              future_mode,
              waggle_preset_id,
              waggle_config_json,
              last_active_at,
              ui_state_json
            )
            VALUES (
              ${branchId},
              ${STANDARD_FUTURE_MODE},
              ${null},
              ${null},
              ${now},
              ${DEFAULT_BRANCH_UI_STATE_JSON}
            )
          `

          yield* sql`
            INSERT INTO session_tree_ui_state (
              session_id,
              expanded_node_ids_json,
              expanded_node_ids_touched,
              branches_sidebar_collapsed,
              updated_at
            )
            VALUES (
              ${sessionId},
              ${EXPANDED_NODE_IDS_DEFAULT_JSON},
              ${EXPANDED_NODE_IDS_UNTOUCHED},
              ${TREE_SIDEBAR_EXPANDED},
              ${now}
            )
          `
        }),
      )
    }),
  )

  return session
}

export async function updateSessionRuntime(input: UpdateSessionRuntimeInput): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET pi_session_id = COALESCE(${input.piSessionId ?? null}, pi_session_id),
            pi_session_file = COALESCE(${input.piSessionFile ?? null}, pi_session_file),
            updated_at = ${Date.now()}
        WHERE id = ${input.sessionId}
      `
    }),
  )
}

export async function persistSessionSnapshot(input: PersistSessionSnapshotInput): Promise<void> {
  const now = Date.now()
  const nodes = [...input.nodes].sort((left, right) => left.createdOrder - right.createdOrder)

  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessionRows = yield* sql<SessionRow>`
        SELECT
          id,
          pi_session_id,
          pi_session_file,
          project_path,
          title,
          archived,
          waggle_config_json,
          created_at,
          updated_at,
          last_active_node_id,
          last_active_branch_id
        FROM sessions
        WHERE id = ${input.sessionId}
        LIMIT 1
      `
      const sessionRow = sessionRows[EMPTY_INDEX]
      if (!sessionRow) {
        throw new Error(`Session ${input.sessionId} not found`)
      }

      const existingBranches = yield* sql<SessionBranchRow>`
        SELECT
          id,
          session_id,
          source_node_id,
          head_node_id,
          name,
          is_main,
          archived_at,
          created_at,
          updated_at
        FROM session_branches
        WHERE session_id = ${input.sessionId}
      `
      const existingBranchStates =
        existingBranches.length > 0
          ? yield* sql<SessionBranchStateRow>`
              SELECT
                branch_id,
                future_mode,
                waggle_preset_id,
                waggle_config_json,
                last_active_at,
                ui_state_json
              FROM session_branch_state
              WHERE branch_id IN ${sql.in(existingBranches.map((branch) => branch.id))}
            `
          : []
      const existingActiveRuns = yield* sql<SessionActiveRunRow>`
        SELECT
          run_id,
          session_id,
          branch_id,
          run_mode,
          status,
          runtime_json,
          updated_at
        FROM session_active_runs
        WHERE session_id = ${input.sessionId}
      `
      const {
        branches,
        activeBranchId,
        activeNodeId: resolvedActiveNodeId,
      } = deriveSessionBranchesForSnapshot({
        sessionId: String(input.sessionId),
        nodes,
        activeNodeId: input.activeNodeId,
        existingBranches,
      })
      const branchHintByNodeId = deriveBranchHints({
        branches,
        nodes,
        activeBranchId,
      })
      const branchStateById = new Map(
        existingBranchStates.map((branchState) => [branchState.branch_id, branchState]),
      )
      const branchIds = new Set(branches.map((branch) => branch.id))

      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`
            DELETE FROM session_active_runs
            WHERE session_id = ${input.sessionId}
          `
          yield* sql`
            DELETE FROM session_branch_state
            WHERE branch_id IN (
              SELECT id FROM session_branches WHERE session_id = ${input.sessionId}
            )
          `
          yield* sql`
            DELETE FROM session_branches
            WHERE session_id = ${input.sessionId}
          `
          yield* sql`
            DELETE FROM session_nodes
            WHERE session_id = ${input.sessionId}
          `

          for (const node of nodes) {
            yield* sql`
              INSERT INTO session_nodes (
                id,
                session_id,
                parent_id,
                pi_entry_type,
                kind,
                role,
                timestamp_ms,
                content_json,
                metadata_json,
                branch_hint_id,
                path_depth,
                created_order
              )
              VALUES (
                ${node.id},
                ${input.sessionId},
                ${node.parentId},
                ${node.piEntryType},
                ${node.kind},
                ${node.role},
                ${node.timestampMs},
                ${node.contentJson},
                ${node.metadataJson},
                ${branchHintByNodeId.get(node.id) ?? null},
                ${node.pathDepth},
                ${node.createdOrder}
              )
            `
          }

          for (const branch of branches) {
            yield* sql`
              INSERT INTO session_branches (
                id,
                session_id,
                source_node_id,
                head_node_id,
                name,
                is_main,
                archived_at,
                created_at,
                updated_at
              )
              VALUES (
                ${branch.id},
                ${input.sessionId},
                ${branch.sourceNodeId},
                ${branch.headNodeId},
                ${branch.name},
                ${branch.isMain ? 1 : 0},
                ${branch.archivedAt},
                ${branch.createdAt},
                ${now}
              )
            `

            const branchState = getBranchStateValue({
              branch,
              activeBranchId,
              waggleConfig: input.waggleConfig,
              existingState: branchStateById.get(branch.id),
              now,
            })

            yield* sql`
              INSERT INTO session_branch_state (
                branch_id,
                future_mode,
                waggle_preset_id,
                waggle_config_json,
                last_active_at,
                ui_state_json
              )
              VALUES (
                ${branch.id},
                ${branchState.futureMode},
                ${branchState.wagglePresetId},
                ${branchState.waggleConfigJson},
                ${branchState.lastActiveAt},
                ${branchState.uiStateJson}
              )
            `
          }

          for (const activeRun of existingActiveRuns) {
            if (!branchIds.has(activeRun.branch_id)) {
              continue
            }

            yield* sql`
              INSERT INTO session_active_runs (
                run_id,
                session_id,
                branch_id,
                run_mode,
                status,
                runtime_json,
                updated_at
              )
              VALUES (
                ${activeRun.run_id},
                ${activeRun.session_id},
                ${activeRun.branch_id},
                ${activeRun.run_mode},
                ${activeRun.status},
                ${activeRun.runtime_json},
                ${activeRun.updated_at}
              )
            `
          }

          yield* sql`
            INSERT INTO session_tree_ui_state (
              session_id,
              expanded_node_ids_json,
              expanded_node_ids_touched,
              branches_sidebar_collapsed,
              updated_at
            )
            VALUES (
              ${input.sessionId},
              ${EXPANDED_NODE_IDS_DEFAULT_JSON},
              ${EXPANDED_NODE_IDS_UNTOUCHED},
              ${TREE_SIDEBAR_EXPANDED},
              ${now}
            )
            ON CONFLICT(session_id) DO UPDATE SET
              updated_at = excluded.updated_at
          `

          yield* sql`
            UPDATE sessions
            SET pi_session_id = ${input.piSessionId},
                pi_session_file = ${input.piSessionFile ?? null},
                waggle_config_json = COALESCE(
                  ${input.waggleConfig ? JSON.stringify(input.waggleConfig) : null},
                  waggle_config_json
                ),
                updated_at = ${now},
                last_active_node_id = ${resolvedActiveNodeId},
                last_active_branch_id = ${activeBranchId}
            WHERE id = ${input.sessionId}
          `
        }),
      )
    }),
  )
}

export async function deleteSession(id: SessionId): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM sessions
        WHERE id = ${id}
      `
    }),
  )
}

async function updateArchivedState(id: SessionId, archived: boolean): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET archived = ${archived ? 1 : 0},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

export async function archiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, true)
}

export async function unarchiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, false)
}

export async function updateSessionTitle(id: SessionId, title: string): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET title = ${title},
            updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}
