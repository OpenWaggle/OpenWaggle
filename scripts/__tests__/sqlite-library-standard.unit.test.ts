import { describe, expect, it } from 'vitest'
import { collectSqliteLibraryViolations } from '../standards/sqlite-library'

// Built at runtime so this file does not load the libraries it describes.
const NODE_SQLITE = ['node', 'sqlite'].join(':')
const SQLITE3 = ['sqlite', '3'].join('')

describe('one SQLite library per process (#371)', () => {
  it('rejects node:sqlite however Host code loads it', () => {
    for (const source of [
      `import { DatabaseSync } from '${NODE_SQLITE}'`,
      `import type { DatabaseSync } from "${NODE_SQLITE}"`,
      `export { DatabaseSync } from '${NODE_SQLITE}'`,
      `const sqlite = await import('${NODE_SQLITE}')`,
      `const { DatabaseSync } = require('${NODE_SQLITE}')`,
      `process.getBuiltinModule('${NODE_SQLITE}')`,
      // A Worker's source string runs in the same process.
      `new Worker(\`const { DatabaseSync } = require('${NODE_SQLITE}')\`, { eval: true })`,
    ]) {
      expect(
        collectSqliteLibraryViolations('src/main/session-host/session-host-upgrade-blockers.ts', source),
        source,
      ).toMatchObject([{ detail: NODE_SQLITE }])
    }
  })

  it('covers tests and scripts, which run Host code in their own process', () => {
    const source = `import { DatabaseSync } from '${NODE_SQLITE}'`
    for (const file of [
      'src/main/session-host/__tests__/session-host-cutover.integration.test.ts',
      'scripts/benchmark-session-discovery-database.ts',
      'packages/pi-waggle/src/index.ts',
    ]) {
      expect(collectSqliteLibraryViolations(file, source), file).toHaveLength(1)
    }
  })

  it('rejects the other SQLite libraries too', () => {
    expect(
      collectSqliteLibraryViolations('src/main/store/settings.ts', `import sqlite3 from '${SQLITE3}'`),
    ).toMatchObject([{ detail: SQLITE3 }])
  })

  it("accepts the Host's library and text that only mentions another one", () => {
    expect(
      collectSqliteLibraryViolations(
        'src/main/session-host/host-sqlite-database.ts',
        [
          "import Database from 'better-sqlite3'",
          `// Replaces the ${NODE_SQLITE} reader: import { DatabaseSync } from '${NODE_SQLITE}'`,
          `const reason = 'two copies of ${NODE_SQLITE} and better-sqlite3'`,
        ].join('\n'),
      ),
    ).toEqual([])
    expect(
      collectSqliteLibraryViolations('docs/notes.md', `import x from '${NODE_SQLITE}'`),
    ).toEqual([])
  })

  it('lets browser import read browser databases, but never next to better-sqlite3', () => {
    const browserSource = `import { DatabaseSync } from '${NODE_SQLITE}'`
    expect(
      collectSqliteLibraryViolations('src/main/browser-import/browser-cookie-database.ts', browserSource),
    ).toEqual([])
    expect(
      collectSqliteLibraryViolations(
        'src/main/browser-import/browser-cookie-database.ts',
        `${browserSource}\nimport Database from 'better-sqlite3'`,
      ),
    ).toMatchObject([{ detail: `${NODE_SQLITE}, better-sqlite3` }])
  })
})
