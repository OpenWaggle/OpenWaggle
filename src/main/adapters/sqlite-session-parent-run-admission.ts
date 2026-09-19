import type * as SqlClient from '@effect/sql/SqlClient'
import { parseJsonUnknown } from '@shared/schema'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { loadProjectConfig } from '../config/project-config'

interface LineageRow {
  readonly parent_session_id: string
  readonly project_path: string
}

interface SettingRow {
  readonly key: string
  readonly value_json: string
}

function positiveSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function projectLimits(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([projectPath, limit]) => {
      const valid = positiveSafeInteger(limit)
      return valid === undefined ? [] : [[projectPath, valid]]
    }),
  )
}

export function directWorkerRunAdmission(sql: SqlClient.SqlClient, sessionId: string) {
  return Effect.gen(function* () {
    const lineageRows = yield* sql<LineageRow>`
      SELECT lineage.parent_session_id, sessions.project_path
      FROM session_spawn_lineage AS lineage
      JOIN sessions ON sessions.id = lineage.child_session_id
      WHERE lineage.child_session_id = ${sessionId}
      LIMIT 1
    `
    const lineage = lineageRows[0]
    if (!lineage) return { admitted: true } as const
    const projectConfig = yield* Effect.tryPromise({
      try: () => loadProjectConfig(lineage.project_path),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    })

    const [activeRows, settingRows] = yield* Effect.all([
      sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count
        FROM session_spawn_lineage AS lineage
        JOIN session_control_states AS states ON states.session_id = lineage.child_session_id
        WHERE lineage.parent_session_id = ${lineage.parent_session_id}
          AND lineage.child_session_id <> ${sessionId}
          AND states.active_run_id IS NOT NULL
      `,
      sql<SettingRow>`
        SELECT key, value_json FROM settings_store
        WHERE key IN ${sql.in([
          'sessionHostParentConcurrencyLimit',
          'sessionHostParentConcurrencyLimitsByProject',
        ])}
      `,
    ])
    const settings = new Map(
      settingRows.map((row) => [row.key, parseJsonUnknown(row.value_json)] as const),
    )
    const fallback =
      positiveSafeInteger(settings.get('sessionHostParentConcurrencyLimit')) ??
      DEFAULT_SETTINGS.sessionHostParentConcurrencyLimit
    const limits = projectLimits(settings.get('sessionHostParentConcurrencyLimitsByProject'))
    const limit =
      projectConfig.sessionHost?.parentConcurrencyLimit ?? limits[lineage.project_path] ?? fallback
    const activeRuns = activeRows[0]?.count ?? 0
    return {
      admitted: activeRuns < limit,
      parentSessionId: lineage.parent_session_id,
      parentConcurrencyLimit: limit,
      parentActiveRuns: activeRuns,
    } as const
  })
}
