import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { readFirefoxCookies } from '../firefox-cookie-reader'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  )
})

async function firefoxDatabase(schemaVersion: number, includeRawSameSite: boolean) {
  const directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-firefox-cookie-test-'))
  temporaryDirectories.push(directory)
  const databasePath = path.join(directory, 'cookies.sqlite')
  const database = new DatabaseSync(databasePath)
  database.exec(`
    PRAGMA user_version = ${String(schemaVersion)};
    CREATE TABLE moz_cookies (
      host TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      path TEXT NOT NULL,
      expiry INTEGER NOT NULL,
      isSecure INTEGER NOT NULL,
      isHttpOnly INTEGER NOT NULL,
      sameSite INTEGER NOT NULL,
      originAttributes TEXT NOT NULL
      ${includeRawSameSite ? ', rawSameSite INTEGER NOT NULL' : ''}
    );
  `)
  return { database, databasePath }
}

describe('Firefox cookie reader', () => {
  it('imports only the default container and preserves schema-14 SameSite semantics', async () => {
    const { database, databasePath } = await firefoxDatabase(14, true)
    const insert = database.prepare(`
      INSERT INTO moz_cookies (
        host, name, value, path, expiry, isSecure, isHttpOnly,
        sameSite, originAttributes, rawSameSite
      ) VALUES (?, ?, ?, '/', ?, 1, 1, ?, ?, ?)
    `)
    insert.run('.example.test', 'session', 'secret', 2_000_000_000, 1, '', 0)
    insert.run('.container.test', 'private', 'hidden', 2_000_000_000, 2, '^userContextId=1', 2)
    database.close()

    await expect(readFirefoxCookies(databasePath)).resolves.toEqual({
      cookies: [
        {
          url: 'https://example.test/',
          domain: '.example.test',
          name: 'session',
          value: 'secret',
          path: '/',
          secure: true,
          httpOnly: true,
          expirationDate: 2_000_000_000,
          sameSite: 'unspecified',
        },
      ],
      skipped: 0,
      skippedDomains: [],
    })
  })

  it('normalizes schema-16 millisecond expiry and skips malformed rows', async () => {
    const { database, databasePath } = await firefoxDatabase(16, false)
    const insert = database.prepare(`
      INSERT INTO moz_cookies (
        host, name, value, path, expiry, isSecure, isHttpOnly,
        sameSite, originAttributes
      ) VALUES (?, ?, ?, ?, ?, 0, 0, ?, '')
    `)
    insert.run('host.example.test', 'valid', 'value', '/', 2_100_000_000_000, 2)
    insert.run('.broken.test', 'broken', 'line\nfeed', '/', 0, 0)
    database.close()

    const result = await readFirefoxCookies(databasePath)

    expect(result.cookies).toEqual([
      {
        url: 'http://host.example.test/',
        name: 'valid',
        value: 'value',
        path: '/',
        secure: false,
        httpOnly: false,
        expirationDate: 2_100_000_000,
        sameSite: 'strict',
      },
    ])
    expect(result.skipped).toBe(1)
    expect(result.skippedDomains).toEqual(['.broken.test'])
  })
})
