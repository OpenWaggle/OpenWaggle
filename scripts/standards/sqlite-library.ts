import { withoutCommentLines } from './comment-stripping'
import type { Violation } from './violation'

/**
 * OpenWaggle opens its own SQLite files only with better-sqlite3, the library of the Session
 * Host's connection (#371). Each SQLite library bundles its own SQLite, POSIX advisory locks belong
 * to the process, and one copy closing a file descriptor drops the locks the other copy holds on
 * that file: https://www.sqlite.org/howtocorrupt.html#_multiple_copies_of_sqlite_linked_into_the_same_application.
 *
 * The check is textual, so a library loaded from a Worker's source string counts as well.
 */
const OTHER_SQLITE_LIBRARIES = [
  'node:sqlite',
  'bun:sqlite',
  'sqlite',
  'sqlite3',
  'sql.js',
  'libsql',
  '@libsql/client',
  '@sqlite.org/sqlite-wasm',
  'better-sqlite3-multiple-ciphers',
] as const

const HOST_SQLITE_LIBRARIES = ['better-sqlite3', '@effect/sql-sqlite-node'] as const

/**
 * The only code that may load another SQLite library: browser import reads the browsers' own
 * cookie and profile databases with node:sqlite and never opens OpenWaggle's files.
 */
const OTHER_SQLITE_LIBRARY_OWNERS: readonly string[] = ['src/main/browser-import/']

const CODE_FILE = /\.(?:[cm]?[jt]s|tsx)$/u
const CHECKED_ROOTS = ['src/', 'scripts/', 'packages/']

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\/]/gu, String.raw`\$&`)
}

/** `from 'x'`, `import 'x'`, `import('x')`, `require('x')`, `getBuiltinModule('x')`. */
function moduleLoadPattern(specifiers: readonly string[]) {
  const names = specifiers.map(escapeRegExp).join('|')
  return new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bgetBuiltinModule\s*\(\s*)(?<quote>["'\x60])(?<library>${names})\k<quote>`,
    'gu',
  )
}

const OTHER_SQLITE_LOAD = moduleLoadPattern(OTHER_SQLITE_LIBRARIES)
const HOST_SQLITE_LOAD = moduleLoadPattern(HOST_SQLITE_LIBRARIES)

function loadedLibraries(source: string, pattern: RegExp) {
  return [...source.matchAll(pattern)].flatMap((match) => match.groups?.['library'] ?? [])
}

function isOwner(file: string) {
  return OTHER_SQLITE_LIBRARY_OWNERS.some((owner) =>
    owner.endsWith('/') ? file.startsWith(owner) : file === owner,
  )
}

export function collectSqliteLibraryViolations(file: string, contents: string): Violation[] {
  const normalized = file.replaceAll('\\', '/')
  if (!CODE_FILE.test(normalized) || !CHECKED_ROOTS.some((root) => normalized.startsWith(root))) {
    return []
  }
  const source = withoutCommentLines(contents)
  const loaded = loadedLibraries(source, OTHER_SQLITE_LOAD)
  if (loaded.length === 0) return []
  if (!isOwner(normalized)) {
    return [
      {
        file: normalized,
        detail: [...new Set(loaded)].join(', '),
        message:
          "Open SQLite with better-sqlite3 (the Host's library; see src/main/session-host/host-sqlite-database.ts). A second SQLite library in one process can drop the Host's file locks and corrupt its database (#371).",
      },
    ]
  }
  const hostLibraries = loadedLibraries(source, HOST_SQLITE_LOAD)
  if (hostLibraries.length === 0) return []
  return [
    {
      file: normalized,
      detail: [...new Set([...loaded, ...hostLibraries])].join(', '),
      message:
        'This file may use another SQLite library only because it never opens files with better-sqlite3; using both opens SQLite files with two SQLite copies in one process (#371).',
    },
  ]
}
