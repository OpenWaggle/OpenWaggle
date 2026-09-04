import type { SqlClient } from '@effect/sql'
import { safeDecodeUnknown } from '@shared/schema'
import { SessionBranchId, SessionId, SessionNodeId } from '@shared/types/brand'
import type {
  SessionBranch,
  SessionBranchState,
  SessionInterruptedRun,
  SessionNode,
  SessionSummary,
} from '@shared/types/session'
import { createWaggleModelBinding, type WaggleConfig } from '@shared/types/waggle'
import { interruptedRunsByBranchId } from './active-run-hydration'
import { DEFAULT_UI_STATE_JSON, MAIN_BRANCH_NAME, STANDARD_FUTURE_MODE } from './constants'
import { parseJson } from './json'
import { expandedNodeIdsSchema, waggleConfigSchema } from './schemas'
import { SESSION_SUMMARY_COLUMN_NAMES } from './types'

export { hydrateRecoverableActiveRun, interruptedRunsByBranchId } from './active-run-hydration'
export { buildSessionNodes, visibleNodeIdForHead } from './node-hydration'

import type {
  SessionActiveRunRow,
  SessionBranchRow,
  SessionBranchStateRow,
  SessionSummaryRow,
  SessionTreeUiStateRow,
} from './types'

export function mainBranchId(sessionId: SessionId) {
  return SessionBranchId(`${sessionId}:${MAIN_BRANCH_NAME}`)
}

export function normalizeSessionListLimit(limit?: number) {
  return limit ?? -1
}

export function hydrateSessionRows(rows: readonly SessionSummaryRow[]) {
  const sessions = rows.map(hydrateSessionSummary)
  return sessions.length > 0 ? sessions : null
}

export function sessionIdsForQuery(sessions: readonly SessionSummary[]) {
  return sessions.map((session) => String(session.id))
}

export function fallbackMainBranch(session: SessionSummary) {
  return {
    id: mainBranchId(session.id),
    sessionId: session.id,
    sourceNodeId: null,
    headNodeId: session.lastActiveNodeId ?? null,
    name: MAIN_BRANCH_NAME,
    isMain: true,
    archivedAt: null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  }
}

export function attachArchivedBranchState(
  sessions: readonly SessionSummary[],
  branchRows: readonly SessionBranchRow[],
) {
  const branchesBySessionId = new Map<string, SessionBranch[]>()
  for (const row of branchRows) {
    const branches = branchesBySessionId.get(row.session_id) ?? []
    branches.push(hydrateBranch(row))
    branchesBySessionId.set(row.session_id, branches)
  }

  return sessions.map((session) => ({
    ...session,
    branches: branchesBySessionId.get(String(session.id)) ?? [],
    treeUiState: null,
  }))
}

export function attachSessionNavigationState(
  sessions: readonly SessionSummary[],
  branchRows: readonly SessionBranchRow[],
  uiStateRows: readonly SessionTreeUiStateRow[],
  activeRunRows: readonly SessionActiveRunRow[],
) {
  const branchesBySessionId = visibleBranchesBySessionId(branchRows, activeRunRows)
  const uiStateBySessionId = new Map(
    uiStateRows.map((row) => [row.session_id, hydrateUiState(row)]),
  )

  return sessions.map((session) => ({
    ...session,
    branches: branchesBySessionId.get(String(session.id)) ?? [fallbackMainBranch(session)],
    treeUiState: uiStateBySessionId.get(String(session.id)) ?? null,
  }))
}

export function hydrateBranch(
  row: SessionBranchRow,
  interruptedRunByBranchId?: ReadonlyMap<string, SessionInterruptedRun>,
) {
  return {
    id: SessionBranchId(row.id),
    sessionId: SessionId(row.session_id),
    sourceNodeId: row.source_node_id ? SessionNodeId(row.source_node_id) : null,
    headNodeId: row.head_node_id ? SessionNodeId(row.head_node_id) : null,
    name: row.name,
    isMain: row.is_main === 1,
    archived: row.archived_at === null ? undefined : true,
    archivedAt: row.archived_at,
    interruptedRun: interruptedRunByBranchId?.get(row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function hydrateBranchState(row: SessionBranchStateRow) {
  return {
    branchId: SessionBranchId(row.branch_id),
    futureMode: row.future_mode,
    waggleConfig: parseWaggleConfig(row.waggle_config_json),
    lastActiveAt: row.last_active_at,
    uiStateJson: row.ui_state_json,
  }
}

export function hydrateUiState(row: SessionTreeUiStateRow) {
  return {
    sessionId: SessionId(row.session_id),
    expandedNodeIds: parseExpandedNodeIds(row.expanded_node_ids_json),
    expandedNodeIdsTouched: row.expanded_node_ids_touched === 1,
    branchesSidebarCollapsed: row.branches_sidebar_collapsed === 1,
    updatedAt: row.updated_at,
  }
}

export function hydrateSessionSummary(row: SessionSummaryRow): SessionSummary {
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
    environmentMode: row.environment_mode === 'worktree' ? 'worktree' : 'local',
    worktreePath: row.worktree_path,
    ...(row.lineage_present === 1
      ? {
          lineage: {
            role: row.lineage_role,
            parentSessionId: row.parent_session_id ? SessionId(row.parent_session_id) : null,
            directWorkerCount: row.direct_worker_count,
            activeDirectWorkerCount: row.active_direct_worker_count,
            agentDefinitionName: row.agent_definition_name,
            delegationState: row.delegation_state,
          },
        }
      : {}),
  }
}

export function fallbackBranchStates(session: SessionSummary) {
  const branchState = {
    branchId: mainBranchId(session.id),
    futureMode: STANDARD_FUTURE_MODE,
    waggleConfig: undefined,
    lastActiveAt: session.updatedAt,
    uiStateJson: DEFAULT_UI_STATE_JSON,
  } satisfies SessionBranchState

  return [branchState]
}

export function fallbackBranches(
  session: SessionSummary,
  nodes: readonly SessionNode[],
  interruptedRunByBranchId: ReadonlyMap<string, SessionInterruptedRun>,
) {
  const lastNode = nodes[nodes.length - 1]
  return [
    {
      id: mainBranchId(session.id),
      sessionId: session.id,
      sourceNodeId: null,
      headNodeId: lastNode?.id ?? null,
      name: MAIN_BRANCH_NAME,
      isMain: true,
      archivedAt: null,
      interruptedRun: interruptedRunByBranchId.get(String(mainBranchId(session.id))),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  ]
}

function visibleBranchesBySessionId(
  branchRows: readonly SessionBranchRow[],
  activeRunRows: readonly SessionActiveRunRow[],
) {
  const branchesBySessionId = new Map<string, SessionBranch[]>()
  const interruptedRunByBranchId = interruptedRunsByBranchId(activeRunRows)
  for (const row of branchRows) {
    if (row.archived_at !== null) continue
    const branches = branchesBySessionId.get(row.session_id) ?? []
    branches.push(hydrateBranch(row, interruptedRunByBranchId))
    branchesBySessionId.set(row.session_id, branches)
  }
  return branchesBySessionId
}

function parseExpandedNodeIds(raw: string) {
  const parsed = safeDecodeUnknown(
    expandedNodeIdsSchema,
    parseJson(raw, 'tree-ui:expanded-node-ids'),
  )
  return parsed.success ? parsed.data.map((id) => SessionNodeId(id)) : []
}

function parseWaggleConfig(raw: string | null): WaggleConfig | undefined {
  if (!raw) return undefined

  const parsed = safeDecodeUnknown(waggleConfigSchema, parseJson(raw, 'branch-state:waggle-config'))
  if (!parsed.success) return undefined

  return {
    ...parsed.data,
    agents: [
      { ...parsed.data.agents[0], model: createWaggleModelBinding(parsed.data.agents[0].model) },
      { ...parsed.data.agents[1], model: createWaggleModelBinding(parsed.data.agents[1].model) },
    ],
  }
}

/**
 * The {@link SessionSummaryRow} column list as a SQL fragment.
 *
 * Lives here rather than in `types.ts` so the type module stays free of a SQL dependency.
 */
export function sessionSummaryColumns(sql: SqlClient.SqlClient) {
  const computedColumns: Readonly<Record<string, string>> = {
    lineage_present: `CASE
      WHEN EXISTS (
        SELECT 1 FROM session_lineage own_lineage WHERE own_lineage.session_id = sessions.id
      ) OR EXISTS (
        SELECT 1 FROM session_lineage child_lineage
        WHERE child_lineage.parent_session_id = sessions.id
      ) THEN 1
      ELSE 0
    END AS lineage_present`,
    lineage_role: `CASE
      WHEN EXISTS (
        SELECT 1 FROM session_lineage own_lineage
        WHERE own_lineage.session_id = sessions.id
          AND own_lineage.parent_session_id IS NOT NULL
      ) THEN 'worker'
      WHEN EXISTS (
        SELECT 1 FROM session_lineage child_lineage
        WHERE child_lineage.parent_session_id = sessions.id
      ) THEN 'queen'
      ELSE 'independent'
    END AS lineage_role`,
    parent_session_id: `(
      SELECT own_lineage.parent_session_id
      FROM session_lineage own_lineage
      WHERE own_lineage.session_id = sessions.id
    ) AS parent_session_id`,
    direct_worker_count: `(
      SELECT COUNT(*) FROM session_lineage child_lineage
      WHERE child_lineage.parent_session_id = sessions.id
    ) AS direct_worker_count`,
    active_direct_worker_count: `(
      SELECT COUNT(*) FROM session_lineage child_lineage
      WHERE child_lineage.parent_session_id = sessions.id
        AND child_lineage.delegation_state NOT IN ('accepted', 'cancelled')
    ) AS active_direct_worker_count`,
    agent_definition_name: `(
      SELECT own_lineage.agent_definition_name
      FROM session_lineage own_lineage
      WHERE own_lineage.session_id = sessions.id
    ) AS agent_definition_name`,
    delegation_state: `(
      SELECT own_lineage.delegation_state
      FROM session_lineage own_lineage
      WHERE own_lineage.session_id = sessions.id
    ) AS delegation_state`,
  }
  return sql.literal(
    SESSION_SUMMARY_COLUMN_NAMES.map((name) => computedColumns[name] ?? name).join(', '),
  )
}
