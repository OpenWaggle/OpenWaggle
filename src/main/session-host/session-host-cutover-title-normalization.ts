import { Schema } from '@shared/schema'
import { boundGeneratedSessionTitle } from '@shared/session-title'
import type { HostSqliteDatabase } from './host-sqlite-database'
import { cutoverTableExists, decodeCutoverRow } from './session-host-cutover-database'

const legacyTitleRowSchema = Schema.Struct({ id: Schema.String, title: Schema.String })

/** Normalize copied legacy titles inside the staging transaction before references are indexed. */
export function normalizeLegacySessionTitles(database: HostSqliteDatabase) {
  if (!cutoverTableExists(database, 'sessions')) return
  const values: unknown = database.prepare('SELECT id, title FROM sessions ORDER BY id').all()
  if (!Array.isArray(values)) throw new Error('Legacy Session titles could not be read.')
  const update = database.prepare('UPDATE sessions SET title = ? WHERE id = ?')
  for (const value of values) {
    const row = decodeCutoverRow(legacyTitleRowSchema, value)
    if (!row) throw new Error('Legacy Session title is invalid.')
    const title = boundGeneratedSessionTitle(row.title)
    if (title !== row.title) update.run(title, row.id)
  }
}
