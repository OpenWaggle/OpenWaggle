import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type HostSqliteDatabase, openHostSqliteDatabase } from '../host-sqlite-database'

const require = createRequire(import.meta.url)

function realPath(modulePath: string) {
  return fs.realpathSync(modulePath)
}

describe('Host SQLite library', () => {
  let temporaryRoot = ''
  const open: HostSqliteDatabase[] = []

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openwaggle-host-sqlite-library-'))
  })

  afterEach(() => {
    for (const database of open.splice(0)) if (database.open) database.close()
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  })

  it('is the better-sqlite3 build the Host runtime connection loads', () => {
    // A second better-sqlite3 version would bring its own SQLite copy into the Host (#371); the
    // pnpm override in pnpm-workspace.yaml keeps @effect/sql-sqlite-node on the app's build.
    const effectClient = require.resolve('@effect/sql-sqlite-node')
    expect(realPath(createRequire(effectClient).resolve('better-sqlite3'))).toBe(
      realPath(require.resolve('better-sqlite3')),
    )
  })

  it('fails at once on a lock another connection holds, as node:sqlite did', () => {
    const databasePath = path.join(temporaryRoot, 'locked.sqlite')
    const holder = openHostSqliteDatabase(databasePath)
    const contender = openHostSqliteDatabase(databasePath)
    open.push(holder, contender)
    holder.exec('CREATE TABLE t (x); BEGIN IMMEDIATE')

    const startedAt = performance.now()
    expect(() => contender.exec('BEGIN IMMEDIATE')).toThrow(
      expect.objectContaining({ code: 'SQLITE_BUSY' }),
    )
    expect(performance.now() - startedAt).toBeLessThan(1_000)
  })

  it('opens read-only without creating a missing file', () => {
    const databasePath = path.join(temporaryRoot, 'missing.sqlite')
    expect(() => openHostSqliteDatabase(databasePath, { readonly: true })).toThrow(
      expect.objectContaining({ code: 'SQLITE_CANTOPEN' }),
    )
    expect(fs.existsSync(databasePath)).toBe(false)
  })
})
