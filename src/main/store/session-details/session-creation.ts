import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { mainBranchId } from './branch-utils'
import {
  DEFAULT_BRANCH_UI_STATE_JSON,
  EXPANDED_NODE_IDS_DEFAULT_JSON,
  EXPANDED_NODE_IDS_UNTOUCHED,
  MAIN_BRANCH_NAME,
  STANDARD_FUTURE_MODE,
  TREE_SIDEBAR_EXPANDED,
} from './constants'
import type { CreateSessionInput } from './types'

function buildNewSessionDetail(
  input: CreateSessionInput,
  id: SessionId,
  now: number,
): SessionDetail {
  return {
    id,
    title: 'New session',
    projectPath: input.projectPath,
    piSessionId: input.piSessionId,
    piSessionFile: input.piSessionFile,
    messages: [],
    createdAt: now,
    updatedAt: now,
  }
}

function insertSessionRow(input: {
  readonly sql: SqlClient.SqlClient
  readonly session: SessionDetail
  readonly sessionId: SessionId
  readonly branchId: string
  readonly input: CreateSessionInput
  readonly now: number
}) {
  return input.sql`
    INSERT INTO sessions (
      id, pi_session_id, pi_session_file, project_path, title, archived, waggle_config_json,
      created_at, updated_at, last_active_node_id, last_active_branch_id
    )
    VALUES (
      ${input.sessionId}, ${input.input.piSessionId}, ${input.input.piSessionFile ?? null},
      ${input.input.projectPath}, ${input.session.title}, ${0}, ${null}, ${input.now}, ${input.now},
      ${null}, ${input.branchId}
    )
  `
}

function insertMainBranchRow(
  sql: SqlClient.SqlClient,
  sessionId: SessionId,
  branchId: string,
  now: number,
) {
  return sql`
    INSERT INTO session_branches (
      id, session_id, source_node_id, head_node_id, name, is_main, archived_at, created_at, updated_at
    )
    VALUES (${branchId}, ${sessionId}, ${null}, ${null}, ${MAIN_BRANCH_NAME}, ${1}, ${null}, ${now}, ${now})
  `
}

function insertInitialBranchState(sql: SqlClient.SqlClient, branchId: string, now: number) {
  return sql`
    INSERT INTO session_branch_state (
      branch_id, future_mode, waggle_preset_id, waggle_config_json, last_active_at, ui_state_json
    )
    VALUES (${branchId}, ${STANDARD_FUTURE_MODE}, ${null}, ${null}, ${now}, ${DEFAULT_BRANCH_UI_STATE_JSON})
  `
}

function insertInitialTreeUiState(sql: SqlClient.SqlClient, sessionId: SessionId, now: number) {
  return sql`
    INSERT INTO session_tree_ui_state (
      session_id, expanded_node_ids_json, expanded_node_ids_touched, branches_sidebar_collapsed, updated_at
    )
    VALUES (
      ${sessionId}, ${EXPANDED_NODE_IDS_DEFAULT_JSON}, ${EXPANDED_NODE_IDS_UNTOUCHED},
      ${TREE_SIDEBAR_EXPANDED}, ${now}
    )
  `
}

export async function createSession(input: CreateSessionInput): Promise<SessionDetail> {
  const now = Date.now()
  const id = SessionId(input.piSessionId)
  const sessionId = SessionId(String(id))
  const branchId = mainBranchId(String(sessionId))
  const session = buildNewSessionDetail(input, id, now)

  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* insertSessionRow({ sql, session, sessionId, branchId, input, now })
          yield* insertMainBranchRow(sql, sessionId, branchId, now)
          yield* insertInitialBranchState(sql, branchId, now)
          yield* insertInitialTreeUiState(sql, sessionId, now)
        }),
      )
    }),
  )

  return session
}
