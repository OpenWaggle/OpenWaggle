/**
 * The fixed Session data workload the Session data budgets measure: one project with 3,000
 * Sessions, one in ten archived and twelve pinned, and one long Session of 2,000 messages (500
 * turns of a request, a tool call, its result and an answer). The long Session and the pins are
 * written through the Session Host's store functions, the 3,000 Sessions with the rows those
 * functions write, in one transaction. Ids, titles, text and every timestamp are fixed, so the
 * store holds the same rows on every run and machine.
 */
import * as SqlClient from '@effect/sql/SqlClient'
import { normalizeSessionReportReference } from '@shared/session-report-reference'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import type { ProjectedSessionNodeInput } from '../../../src/main/ports/session-repository'
import { pinSession } from '../../../src/main/store/pinned-sessions'
import {
  createSession,
  persistSessionSnapshot,
  updateSessionTitle,
} from '../../../src/main/store/session-details'
import { mainBranchId } from '../../../src/main/store/session-details/branch-utils'
import {
  DEFAULT_BRANCH_UI_STATE_JSON,
  EXPANDED_NODE_IDS_DEFAULT_JSON,
  EXPANDED_NODE_IDS_UNTOUCHED,
  MAIN_BRANCH_NAME,
  STANDARD_FUTURE_MODE,
  TREE_SIDEBAR_EXPANDED,
} from '../../../src/main/store/session-details/constants'
import { runStoreEffect } from '../../../src/main/store/store-runtime'

/** A project path, not a directory: nothing reads it from disk, and it is the same everywhere. */
const PERF_PROJECT_PATH = '/work/perf-budgets/openwaggle'
export const LONG_SESSION_ID = SessionId('perf-session-long')
const PROJECT_SESSION_COUNT = 3_000
const LONG_SESSION_MESSAGES = 2_000

const ARCHIVED_EVERY = 10
const PINNED_EVERY = 250
export const PINNED_SESSION_COUNT = PROJECT_SESSION_COUNT / PINNED_EVERY
/** 2026-01-05T09:00:00Z: the first Session's creation; each later write is one minute on. */
const SEEDED_AT_MS = 1_767_603_600_000
const MINUTE_MS = 60_000
const SECOND_MS = 1_000
const MESSAGES_PER_TURN = 4
const SESSION_ID_DIGITS = 4
const ANSWER_SENTENCES = 3
const MODEL = 'openai/gpt-5.4'

const VERBS = ['Fix', 'Refactor', 'Review', 'Document', 'Test', 'Profile', 'Migrate', 'Debug']
const SUBJECTS = [
  'the sidebar search',
  'Session Host start-up',
  'the composer draft store',
  'MCP server reconnects',
  'the diff panel',
  'provider sign-in',
  'worktree clean-up',
  'the release workflow',
  'terminal resizing',
  'archived item paging',
  'the Hive panel',
  'the model picker',
]
const TOOLS = ['read', 'grep', 'bash', 'edit']
const SENTENCES = [
  'The catalog query reads one page of Sessions ordered by their last update.',
  'Each summary carries its branches, its tree state and the latest Run.',
  'The renderer keeps the newest window of messages and pages older ones in on scroll.',
  'A failing check names the file, the line and the fix to apply.',
  'The store writes every node of a snapshot in one transaction.',
  'Pinned Sessions are read by id, in batches the Host accepts.',
  'The workspace read returns the newest part of the selected path.',
  'Nothing in this answer depends on the clock or the machine it runs on.',
]

function pick<T>(values: readonly T[], index: number): T {
  const value = values[index % values.length]
  if (value === undefined) throw new Error('Cannot pick from an empty list.')
  return value
}

function paragraph(seed: number, sentences: number) {
  return Array.from({ length: sentences }, (_, offset) => pick(SENTENCES, seed + offset)).join(' ')
}

function projectSessionId(index: number) {
  return `perf-session-${String(index).padStart(SESSION_ID_DIGITS, '0')}`
}

function node(
  order: number,
  kind: ProjectedSessionNodeInput['kind'],
  role: ProjectedSessionNodeInput['role'],
  content: object,
): ProjectedSessionNodeInput {
  return {
    id: `perf-long-node-${String(order)}`,
    parentId: order === 0 ? null : `perf-long-node-${String(order - 1)}`,
    piEntryType: 'message',
    kind,
    role,
    timestampMs: SEEDED_AT_MS + order * SECOND_MS,
    contentJson: JSON.stringify(content),
    metadataJson: '{}',
    pathDepth: order,
    createdOrder: order,
  }
}

/** One turn: the request, the call, its result and the answer. */
function turnNodes(turn: number): ProjectedSessionNodeInput[] {
  const first = turn * MESSAGES_PER_TURN
  const tool = pick(TOOLS, turn)
  const args = { path: `src/feature-${String(turn % 37)}/module-${String(turn % 11)}.ts` }
  const toolCall = { id: `call-${String(turn)}`, name: tool, args }
  const request = `${pick(VERBS, turn)} ${pick(SUBJECTS, turn)} in ${args.path}. ${paragraph(turn, 1)}`
  return [
    node(first, 'user_message', 'user', { parts: [{ type: 'text', text: request }], model: null }),
    node(first + 1, 'assistant_message', 'assistant', {
      parts: [
        { type: 'text', text: paragraph(turn + 1, 2) },
        { type: 'tool-call', toolCall: { ...toolCall, state: 'input-complete' } },
      ],
      model: MODEL,
    }),
    node(first + 2, 'tool_result', null, {
      parts: [
        {
          type: 'tool-result',
          toolResult: {
            ...toolCall,
            result: { content: [{ type: 'text', text: paragraph(turn + 2, ANSWER_SENTENCES) }] },
            isError: false,
            duration: turn % SENTENCES.length,
          },
        },
      ],
      model: null,
    }),
    node(first + MESSAGES_PER_TURN - 1, 'assistant_message', 'assistant', {
      parts: [{ type: 'text', text: paragraph(turn + MESSAGES_PER_TURN, ANSWER_SENTENCES) }],
      model: MODEL,
    }),
  ]
}

interface ProjectSessionRow {
  readonly id: string
  readonly branchId: string
  readonly title: string
  readonly reference: string
  readonly at: number
}

function projectSessionRows(): ProjectSessionRow[] {
  return Array.from({ length: PROJECT_SESSION_COUNT }, (_, index) => {
    const id = projectSessionId(index)
    const title = `${pick(VERBS, index)} ${pick(SUBJECTS, index)} (${String(index + 1)})`
    return {
      id,
      branchId: mainBranchId(id),
      title,
      reference: normalizeSessionReportReference(title),
      at: SEEDED_AT_MS + index * MINUTE_MS,
    }
  })
}

/**
 * The project's Sessions as `createSession` followed by `updateSessionTitle` (and
 * `archiveSession` for one in ten) writes them, in one transaction: 3,000 of each call take most
 * of a minute on a loaded runner. Only `json_each` over the rows differs from those calls.
 */
function insertProjectSessions(sql: SqlClient.SqlClient, rows: readonly ProjectSessionRow[]) {
  const json = JSON.stringify(rows)
  const archived = JSON.stringify(
    rows.filter((_, index) => index % ARCHIVED_EVERY === ARCHIVED_EVERY - 1).map((row) => row.id),
  )
  const row = (field: keyof ProjectSessionRow) => sql.unsafe(`json_extract(value, '$.${field}')`)
  return sql.withTransaction(
    Effect.all([
      sql`
        INSERT INTO sessions (
          id, pi_session_id, pi_session_file, project_path, title, title_source,
          title_needs_refinement, archived, waggle_config_json, created_at, updated_at,
          last_active_node_id, last_active_branch_id, environment_mode,
          authorization_mode_override
        )
        SELECT ${row('id')}, ${row('id')}, NULL, ${PERF_PROJECT_PATH}, ${row('title')}, 'manual',
          0, 0, NULL, ${row('at')}, ${row('at')}, NULL, ${row('branchId')}, 'local', NULL
        FROM json_each(${json})
      `,
      sql`
        INSERT INTO session_branches (
          id, session_id, source_node_id, head_node_id, name, is_main, archived_at, created_at,
          updated_at
        )
        SELECT ${row('branchId')}, ${row('id')}, NULL, NULL, ${MAIN_BRANCH_NAME}, 1, NULL,
          ${row('at')}, ${row('at')}
        FROM json_each(${json})
      `,
      sql`
        INSERT INTO session_branch_state (
          branch_id, future_mode, waggle_preset_id, waggle_config_json, last_active_at,
          ui_state_json
        )
        SELECT ${row('branchId')}, ${STANDARD_FUTURE_MODE}, NULL, NULL, ${row('at')},
          ${DEFAULT_BRANCH_UI_STATE_JSON}
        FROM json_each(${json})
      `,
      sql`
        INSERT INTO session_tree_ui_state (
          session_id, expanded_node_ids_json, expanded_node_ids_touched,
          branches_sidebar_collapsed, updated_at
        )
        SELECT ${row('id')}, ${EXPANDED_NODE_IDS_DEFAULT_JSON}, ${EXPANDED_NODE_IDS_UNTOUCHED},
          ${TREE_SIDEBAR_EXPANDED}, ${row('at')}
        FROM json_each(${json})
      `,
      sql`
        INSERT INTO session_report_references (session_id, kind, normalized_reference)
        SELECT ${row('id')}, 'title', ${row('reference')} FROM json_each(${json})
      `,
      // As archiveSession does: its trigger stamps archived_at with the row's updated_at.
      sql`UPDATE sessions SET archived = 1 WHERE id IN (SELECT value FROM json_each(${archived}))`,
    ]),
  )
}

/**
 * Writes the workload into the store the app runtime opened. `setNow` sets what `Date.now`
 * returns, so every timestamp the store writes is fixed.
 */
export async function seedSessionDataWorkload(setNow: (milliseconds: number) => void) {
  const rows = projectSessionRows()
  await runStoreEffect(
    Effect.flatMap(SqlClient.SqlClient, (sql) => insertProjectSessions(sql, rows)),
  )
  for (const [index, row] of rows.entries()) {
    if (index % PINNED_EVERY !== 0) continue
    setNow(row.at)
    await pinSession(SessionId(row.id))
  }
  setNow(SEEDED_AT_MS + PROJECT_SESSION_COUNT * MINUTE_MS)
  await createSession({ projectPath: PERF_PROJECT_PATH, piSessionId: String(LONG_SESSION_ID) })
  await updateSessionTitle(LONG_SESSION_ID, 'Speed up the Session catalog for large projects')
  const nodes = Array.from({ length: LONG_SESSION_MESSAGES / MESSAGES_PER_TURN }, (_, turn) =>
    turnNodes(turn),
  ).flat()
  await persistSessionSnapshot({
    sessionId: LONG_SESSION_ID,
    piSessionId: String(LONG_SESSION_ID),
    activeNodeId: nodes.at(-1)?.id ?? null,
    nodes,
  })
}
