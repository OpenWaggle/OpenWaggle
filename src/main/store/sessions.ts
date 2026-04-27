import * as SqlClient from '@effect/sql/SqlClient'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { SessionBranchId, SessionId, SessionNodeId, SupportedModelId } from '@shared/types/brand'
import type {
  SessionBranch,
  SessionBranchState,
  SessionNode,
  SessionSummary,
  SessionTranscriptEntry,
  SessionTree,
  SessionTreeUiState,
  SessionWorkspace,
  SessionWorkspaceSelection,
} from '@shared/types/session'
import type { WaggleConfig } from '@shared/types/waggle'
import { isRecord } from '@shared/utils/validation'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { runAppEffect } from '../runtime'
import {
  hydrateConversationMessage,
  hydrateStructuralConversationMessage,
  type SessionNodeRow,
} from './session-conversations'
import { buildPiWorkingContextPath } from './session-working-context'

const MESSAGE_ENTRY_TYPE = 'message'
const CUSTOM_MESSAGE_ENTRY_TYPE = 'custom_message'
const MAIN_BRANCH_NAME = 'main'
const STANDARD_FUTURE_MODE = 'standard'
const DEFAULT_UI_STATE_JSON = '{}'
const EMPTY_INDEX = 0
const logger = createLogger('store/sessions')

interface SessionSummaryRow {
  readonly id: string
  readonly title: string
  readonly project_path: string | null
  readonly archived: number
  readonly created_at: number
  readonly updated_at: number
  readonly last_active_node_id: string | null
  readonly last_active_branch_id: string | null
}

interface SessionBranchRow {
  readonly id: string
  readonly session_id: string
  readonly source_node_id: string | null
  readonly head_node_id: string | null
  readonly name: string
  readonly is_main: number
  readonly created_at: number
  readonly updated_at: number
}

interface SessionBranchStateRow {
  readonly branch_id: string
  readonly future_mode: 'standard' | 'waggle'
  readonly waggle_config_json: string | null
  readonly last_active_at: number
  readonly ui_state_json: string
}

interface SessionTreeUiStateRow {
  readonly session_id: string
  readonly expanded_node_ids_json: string
  readonly branches_sidebar_collapsed: number
  readonly updated_at: number
}

const expandedNodeIdsSchema = Schema.mutable(Schema.Array(Schema.String))
const waggleConfigSchema = Schema.Struct({
  mode: Schema.Literal('sequential'),
  agents: Schema.Tuple(
    Schema.Struct({
      label: Schema.String,
      model: Schema.String,
      roleDescription: Schema.String,
      color: Schema.Literal('blue', 'amber', 'emerald', 'violet'),
    }),
    Schema.Struct({
      label: Schema.String,
      model: Schema.String,
      roleDescription: Schema.String,
      color: Schema.Literal('blue', 'amber', 'emerald', 'violet'),
    }),
  ),
  stop: Schema.Struct({
    primary: Schema.Literal('consensus', 'user-stop'),
    maxTurnsSafety: Schema.Number,
  }),
})

function mainBranchId(sessionId: SessionId): SessionBranchId {
  return SessionBranchId(`${sessionId}:${MAIN_BRANCH_NAME}`)
}

function parseJson(raw: string, context: string): unknown {
  try {
    return JSON.parse(raw)
  } catch (error) {
    logger.warn('Failed to parse session JSON metadata', {
      context,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function isHiddenCustomMessageRow(row: SessionNodeRow): boolean {
  if (row.pi_entry_type !== CUSTOM_MESSAGE_ENTRY_TYPE) {
    return false
  }

  const metadata = parseJson(row.metadata_json, `node:${row.id}:metadata`)
  return isRecord(metadata) && metadata.display === false
}

function parseExpandedNodeIds(raw: string): readonly SessionNodeId[] {
  const parsed = safeDecodeUnknown(
    expandedNodeIdsSchema,
    parseJson(raw, 'tree-ui:expanded-node-ids'),
  )
  return parsed.success ? parsed.data.map((id) => SessionNodeId(id)) : []
}

function parseWaggleConfig(raw: string | null): WaggleConfig | undefined {
  if (!raw) {
    return undefined
  }

  const parsed = safeDecodeUnknown(waggleConfigSchema, parseJson(raw, 'branch-state:waggle-config'))
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

function hydrateSessionSummary(row: SessionSummaryRow): SessionSummary {
  return {
    id: SessionId(row.id),
    title: row.title,
    projectPath: row.project_path,
    archived: row.archived === 1 ? true : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveNodeId: row.last_active_node_id ? SessionNodeId(row.last_active_node_id) : null,
    lastActiveBranchId: row.last_active_branch_id
      ? SessionBranchId(row.last_active_branch_id)
      : null,
  }
}

function hydrateBranch(row: SessionBranchRow): SessionBranch {
  return {
    id: SessionBranchId(row.id),
    sessionId: SessionId(row.session_id),
    sourceNodeId: row.source_node_id ? SessionNodeId(row.source_node_id) : null,
    headNodeId: row.head_node_id ? SessionNodeId(row.head_node_id) : null,
    name: row.name,
    isMain: row.is_main === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function hydrateBranchState(row: SessionBranchStateRow): SessionBranchState {
  return {
    branchId: SessionBranchId(row.branch_id),
    futureMode: row.future_mode,
    waggleConfig: parseWaggleConfig(row.waggle_config_json),
    lastActiveAt: row.last_active_at,
    uiStateJson: row.ui_state_json,
  }
}

function hydrateUiState(row: SessionTreeUiStateRow): SessionTreeUiState {
  return {
    sessionId: SessionId(row.session_id),
    expandedNodeIds: parseExpandedNodeIds(row.expanded_node_ids_json),
    branchesSidebarCollapsed: row.branches_sidebar_collapsed === 1,
    updatedAt: row.updated_at,
  }
}

function buildVisibleParentByRowId(
  rows: readonly SessionNodeRow[],
): ReadonlyMap<string, string | null> {
  const rowById = new Map(rows.map((row) => [row.id, row]))
  const visibleParentById = new Map<string, string | null>()

  for (const row of rows) {
    if (isHiddenCustomMessageRow(row)) {
      continue
    }

    let parentId = row.parent_id
    while (parentId) {
      const parent = rowById.get(parentId)
      if (!parent) {
        parentId = null
        break
      }
      if (!isHiddenCustomMessageRow(parent)) {
        break
      }
      parentId = parent.parent_id
    }

    visibleParentById.set(row.id, parentId)
  }

  return visibleParentById
}

function getVisiblePathDepth(
  rowId: string,
  visibleParentById: ReadonlyMap<string, string | null>,
  depthById: Map<string, number>,
): number {
  const cached = depthById.get(rowId)
  if (cached !== undefined) {
    return cached
  }

  const parentId = visibleParentById.get(rowId) ?? null
  const depth = parentId ? getVisiblePathDepth(parentId, visibleParentById, depthById) + 1 : 0
  depthById.set(rowId, depth)
  return depth
}

function findBranchById(
  branches: readonly SessionBranch[],
  branchId: SessionBranchId | null | undefined,
): SessionBranch | null {
  if (!branchId) {
    return null
  }
  return branches.find((branch) => branch.id === branchId) ?? null
}

function findNodeById(
  nodes: readonly SessionNode[],
  nodeId: SessionNodeId | null | undefined,
): SessionNode | null {
  if (!nodeId) {
    return null
  }
  return nodes.find((node) => node.id === nodeId) ?? null
}

function getDefaultBranch(tree: SessionTree): SessionBranch | null {
  return tree.branches.find((branch) => branch.isMain) ?? tree.branches[EMPTY_INDEX] ?? null
}

function getNodeBranch(tree: SessionTree, node: SessionNode | null): SessionBranch | null {
  if (!node?.branchId) {
    return null
  }
  return findBranchById(tree.branches, node.branchId)
}

function resolveWorkspaceBranch(
  tree: SessionTree,
  selection: SessionWorkspaceSelection | undefined,
  selectedNode: SessionNode | null,
): SessionBranch | null {
  return (
    findBranchById(tree.branches, selection?.branchId) ??
    getNodeBranch(tree, selectedNode) ??
    findBranchById(tree.branches, tree.session.lastActiveBranchId) ??
    getDefaultBranch(tree)
  )
}

function resolveWorkspaceNode(
  tree: SessionTree,
  selection: SessionWorkspaceSelection | undefined,
  activeBranch: SessionBranch | null,
): SessionNode | null {
  return (
    findNodeById(tree.nodes, selection?.nodeId) ??
    findNodeById(tree.nodes, activeBranch?.headNodeId) ??
    findNodeById(tree.nodes, tree.session.lastActiveNodeId) ??
    tree.nodes[tree.nodes.length - 1] ??
    null
  )
}

function buildTranscriptPath(
  tree: SessionTree,
  activeNodeId: SessionNodeId | null,
): readonly SessionTranscriptEntry[] {
  return buildPiWorkingContextPath(activeNodeId ? String(activeNodeId) : null, tree.nodes, {
    getId: (node) => String(node.id),
    getParentId: (node) => (node.parentId ? String(node.parentId) : null),
    getKind: (node) => node.kind,
    getContentJson: (node) => node.contentJson,
  }).map((node) => ({
    node,
    branchId: node.branchId,
    isActive: node.id === activeNodeId,
  }))
}

function buildSessionWorkspace(
  tree: SessionTree,
  selection?: SessionWorkspaceSelection,
): SessionWorkspace {
  const selectedNode = findNodeById(tree.nodes, selection?.nodeId)
  const activeBranch = resolveWorkspaceBranch(tree, selection, selectedNode)
  const activeNode = resolveWorkspaceNode(tree, selection, activeBranch)
  const activeBranchState = tree.branchStates.find((state) => state.branchId === activeBranch?.id)

  return {
    tree,
    activeBranchId: activeBranch?.id ?? null,
    activeNodeId: activeNode?.id ?? null,
    activeBranchState,
    transcriptPath: buildTranscriptPath(tree, activeNode?.id ?? null),
  }
}

export async function listSessions(limit?: number): Promise<SessionSummary[]> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const effectiveLimit = limit ?? -1
      const rows = yield* sql<SessionSummaryRow>`
        SELECT
          id,
          title,
          project_path,
          archived,
          created_at,
          updated_at,
          last_active_node_id,
          last_active_branch_id
        FROM sessions
        WHERE archived = 0
        ORDER BY updated_at DESC
        LIMIT ${effectiveLimit}
      `

      return rows.map(hydrateSessionSummary)
    }),
  )
}

export async function getSessionTree(sessionId: SessionId): Promise<SessionTree | null> {
  return runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const sessionRows = yield* sql<SessionSummaryRow>`
        SELECT
          id,
          title,
          project_path,
          archived,
          created_at,
          updated_at,
          last_active_node_id,
          last_active_branch_id
        FROM sessions
        WHERE id = ${sessionId}
        LIMIT 1
      `
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
        WHERE session_id = ${sessionId}
        ORDER BY created_order ASC
      `
      const branchRows = yield* sql<SessionBranchRow>`
        SELECT
          id,
          session_id,
          source_node_id,
          head_node_id,
          name,
          is_main,
          created_at,
          updated_at
        FROM session_branches
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC
      `
      const branchStateRows =
        branchRows.length > 0
          ? yield* sql<SessionBranchStateRow>`
              SELECT
                branch_id,
                future_mode,
                waggle_config_json,
                last_active_at,
                ui_state_json
              FROM session_branch_state
              WHERE branch_id IN ${sql.in(branchRows.map((branch) => branch.id))}
            `
          : []
      const uiStateRows = yield* sql<SessionTreeUiStateRow>`
        SELECT
          session_id,
          expanded_node_ids_json,
          branches_sidebar_collapsed,
          updated_at
        FROM session_tree_ui_state
        WHERE session_id = ${sessionId}
        LIMIT 1
      `

      const sessionRow = sessionRows[EMPTY_INDEX]
      if (!sessionRow) {
        return null
      }

      const visibleNodeRows = nodeRows.filter((row) => !isHiddenCustomMessageRow(row))
      const visibleParentById = buildVisibleParentByRowId(nodeRows)
      const visibleDepthById = new Map<string, number>()
      const session = hydrateSessionSummary(sessionRow)
      const nodes: SessionNode[] = visibleNodeRows.map((row) => {
        const parentId = visibleParentById.get(row.id) ?? null
        return {
          id: SessionNodeId(row.id),
          sessionId: SessionId(row.session_id),
          parentId: parentId ? SessionNodeId(parentId) : null,
          piEntryType: row.pi_entry_type,
          kind: row.kind,
          role: row.role ?? undefined,
          timestampMs: row.timestamp_ms,
          createdOrder: row.created_order,
          pathDepth: getVisiblePathDepth(row.id, visibleParentById, visibleDepthById),
          branchId: row.branch_hint_id ? SessionBranchId(row.branch_hint_id) : null,
          message:
            row.role !== null &&
            (row.pi_entry_type === MESSAGE_ENTRY_TYPE ||
              row.kind === 'user_message' ||
              row.kind === 'assistant_message')
              ? hydrateConversationMessage(row)
              : (hydrateStructuralConversationMessage(row) ?? undefined),
          contentJson: row.content_json,
          metadataJson: row.metadata_json,
        }
      })
      const lastNode = nodes[nodes.length - 1]

      return {
        session,
        nodes,
        branches:
          branchRows.length > 0
            ? branchRows.map(hydrateBranch)
            : [
                {
                  id: mainBranchId(session.id),
                  sessionId: session.id,
                  sourceNodeId: null,
                  headNodeId: lastNode?.id ?? null,
                  name: MAIN_BRANCH_NAME,
                  isMain: true,
                  createdAt: session.createdAt,
                  updatedAt: session.updatedAt,
                },
              ],
        branchStates:
          branchStateRows.length > 0
            ? branchStateRows.map(hydrateBranchState)
            : [
                {
                  branchId: mainBranchId(session.id),
                  futureMode: STANDARD_FUTURE_MODE,
                  waggleConfig: undefined,
                  lastActiveAt: session.updatedAt,
                  uiStateJson: DEFAULT_UI_STATE_JSON,
                },
              ],
        uiState: uiStateRows[EMPTY_INDEX] ? hydrateUiState(uiStateRows[EMPTY_INDEX]) : null,
      }
    }),
  )
}

export async function getSessionWorkspace(
  sessionId: SessionId,
  selection?: SessionWorkspaceSelection,
): Promise<SessionWorkspace | null> {
  const tree = await getSessionTree(sessionId)
  return tree ? buildSessionWorkspace(tree, selection) : null
}
