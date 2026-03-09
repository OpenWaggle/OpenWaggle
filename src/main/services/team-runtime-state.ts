import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { runAppEffect } from '../runtime'

export interface TeamRuntimeStateRow {
  readonly project_path: string
  readonly team_name: string
  readonly team_config_json: string | null
  readonly tasks_json: string | null
  readonly pending_messages_json: string | null
  readonly updated_at: number
}

export interface TeamRuntimeStateUpdate {
  readonly projectPath: string
  readonly teamName: string
  readonly teamConfigJson?: string | null
  readonly tasksJson?: string | null
  readonly pendingMessagesJson?: string | null
}

async function getExistingRow(
  projectPath: string,
  teamName: string,
): Promise<TeamRuntimeStateRow | null> {
  const rows = await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      return yield* sql<TeamRuntimeStateRow>`
        SELECT
          project_path,
          team_name,
          team_config_json,
          tasks_json,
          pending_messages_json,
          updated_at
        FROM team_runtime_state
        WHERE project_path = ${projectPath}
          AND team_name = ${teamName}
        LIMIT 1
      `
    }),
  )

  return rows[0] ?? null
}

export async function readTeamRuntimeState(
  projectPath: string,
  teamName: string,
): Promise<TeamRuntimeStateRow | null> {
  return getExistingRow(projectPath, teamName)
}

export async function writeTeamRuntimeState(update: TeamRuntimeStateUpdate): Promise<void> {
  const existing = await getExistingRow(update.projectPath, update.teamName)
  const teamConfigJson =
    update.teamConfigJson === undefined
      ? (existing?.team_config_json ?? null)
      : update.teamConfigJson
  const tasksJson =
    update.tasksJson === undefined ? (existing?.tasks_json ?? null) : update.tasksJson
  const pendingMessagesJson =
    update.pendingMessagesJson === undefined
      ? (existing?.pending_messages_json ?? null)
      : update.pendingMessagesJson

  if (teamConfigJson === null && tasksJson === null && pendingMessagesJson === null) {
    await deleteTeamRuntimeState(update.projectPath, update.teamName)
    return
  }

  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        INSERT INTO team_runtime_state (
          project_path,
          team_name,
          team_config_json,
          tasks_json,
          pending_messages_json,
          updated_at
        )
        VALUES (
          ${update.projectPath},
          ${update.teamName},
          ${teamConfigJson},
          ${tasksJson},
          ${pendingMessagesJson},
          ${Date.now()}
        )
        ON CONFLICT(project_path, team_name) DO UPDATE SET
          team_config_json = excluded.team_config_json,
          tasks_json = excluded.tasks_json,
          pending_messages_json = excluded.pending_messages_json,
          updated_at = excluded.updated_at
      `
    }),
  )
}

export async function deleteTeamRuntimeState(projectPath: string, teamName: string): Promise<void> {
  await runAppEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        DELETE FROM team_runtime_state
        WHERE project_path = ${projectPath}
          AND team_name = ${teamName}
      `
    }),
  )
}
