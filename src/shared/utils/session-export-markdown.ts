import { uncheckedFields } from './object-shape'

/**
 * A Markdown export record's heading: its role, or `hive` for the Host's Hive wake notice, which
 * sits where a user message would but no user wrote. The CLI stream and the export file share it.
 */
export function sessionExportMarkdownHeading(record: {
  readonly role?: unknown
  readonly metadata?: unknown
}) {
  if (uncheckedFields<{ readonly hiveWake: boolean }>(record.metadata).hiveWake === true) {
    return 'hive'
  }
  return typeof record.role === 'string' ? record.role : 'event'
}
