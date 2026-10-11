/**
 * A file recorded as migrated can come back in the old format: it was absent at the first
 * launch, or a dotfiles checkout or git pull later restored an old copy. Pi would load it as it
 * is, with servers the old OpenWaggle never connected turned on. Such a file is migrated again,
 * once it differs from what was recorded and still carries fields only the old OpenWaggle wrote.
 */
import { isRecord } from '@shared/utils/validation'
import { contentHash, parseJsonDocument } from './json-document'
import type { McpMigrationFs } from './migration-fs'
import type { McpMigrationRecord } from './migration-record'

/**
 * Fields only the old OpenWaggle wrote, never Pi: `auth`, `required` or `transport` are not here,
 * since a current file could hold them.
 */
const OLD_FORMAT_ONLY_FIELDS = ['directTools', 'provenance', 'trustedConfigHash'] as const

function hasOldFormatEntry(text: string, filePath: string) {
  try {
    const { mcpServers } = parseJsonDocument(filePath, text).value
    if (!isRecord(mcpServers)) return false
    return Object.values(mcpServers).some(
      (entry) => isRecord(entry) && OLD_FORMAT_ONLY_FIELDS.some((field) => field in entry),
    )
  } catch {
    // A file that cannot be parsed is the loader's error to show, not something to migrate.
    return false
  }
}

/** Whether a file recorded with `recordedHash` is now an old-format file to migrate again. */
async function reappearedInOldFormat(
  fs: McpMigrationFs,
  filePath: string,
  recordedHash: string | null | undefined,
) {
  const text = await fs.readText(filePath).catch(() => undefined)
  if (text === undefined || contentHash(text) === recordedHash) return false
  return hasOldFormatEntry(text, filePath)
}

/** Whether the file is recorded as migrated and has not come back in the old format since. */
export async function isStillMigrated(
  fs: McpMigrationFs,
  record: McpMigrationRecord,
  filePath: string,
) {
  if (!record.isFileMigrated(filePath)) return false
  return !(await reappearedInOldFormat(fs, filePath, record.fileContentHash(filePath)))
}
