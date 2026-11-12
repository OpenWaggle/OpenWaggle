import Database from 'better-sqlite3'

/**
 * A connection to one of OpenWaggle's own SQLite files, opened with better-sqlite3: the library
 * the Session Host's runtime connection uses.
 *
 * Every OpenWaggle process opens these files with this one library. Each SQLite library bundles its
 * own copy of SQLite, POSIX advisory locks belong to the process, and one copy closing a file
 * descriptor drops the locks the other copy holds on the same file, which can corrupt it
 * (https://www.sqlite.org/howtocorrupt.html#_multiple_copies_of_sqlite_linked_into_the_same_application).
 * `bun run check:repository-standards` rejects `node:sqlite` outside the files it allows (#371).
 */
export type HostSqliteDatabase = Database.Database

/**
 * Opens without a busy timeout, as node:sqlite did: a lock held by another connection fails at once
 * with `SQLITE_BUSY`. The ownership lock depends on that; the cutover was written against it.
 */
const NO_BUSY_TIMEOUT_MS = 0

/** Typed as a value: declarations cannot name better-sqlite3's inferred `Database` type. */
export const openHostSqliteDatabase: (
  filePath: string,
  options?: { readonly readonly?: boolean },
) => HostSqliteDatabase = (filePath, options = {}) =>
  new Database(filePath, {
    readonly: options.readonly ?? false,
    timeout: NO_BUSY_TIMEOUT_MS,
  })
