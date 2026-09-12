import type { DatabaseSync } from 'node:sqlite'
import { boundGeneratedSessionTitle } from '@shared/session-title'
import { cutoverRecord, cutoverTableExists } from './session-host-cutover-database'

/** Normalize copied legacy titles inside the staging transaction before references are indexed. */
export function normalizeLegacySessionTitles(database: DatabaseSync) {
  if (!cutoverTableExists(database, 'sessions')) return
  const values: unknown = database.prepare('SELECT id, title FROM sessions ORDER BY id').all()
  if (!Array.isArray(values)) throw new Error('Legacy Session titles could not be read.')
  const update = database.prepare('UPDATE sessions SET title = ? WHERE id = ?')
  for (const value of values) {
    const row = cutoverRecord(value)
    if (typeof row?.id !== 'string' || typeof row.title !== 'string') {
      throw new Error('Legacy Session title is invalid.')
    }
    const title = boundGeneratedSessionTitle(row.title)
    if (title !== row.title) update.run(title, row.id)
  }
}
