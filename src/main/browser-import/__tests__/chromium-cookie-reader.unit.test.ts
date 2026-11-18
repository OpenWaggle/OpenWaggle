import { createCipheriv, createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { BrowserImportError } from '../browser-import-errors'
import { deriveChromiumCbcKey } from '../chromium-cookie-keys'
import { decryptChromiumValue, readChromiumCookieDatabase } from '../chromium-cookie-reader'

const CBC_IV = Buffer.alloc(16, 0x20)

function cbcValue(value: string, key: Buffer, prefix: 'v10' | 'v11', domain?: string) {
  const plaintext = Buffer.concat([
    ...(domain ? [createHash('sha256').update(domain).digest()] : []),
    Buffer.from(value),
  ])
  const cipher = createCipheriv('aes-128-cbc', key, CBC_IV)
  return Buffer.concat([Buffer.from(prefix), cipher.update(plaintext), cipher.final()])
}

function gcmValue(value: string, key: Buffer, domain?: string) {
  const nonce = Buffer.alloc(12, 0x11)
  const plaintext = Buffer.concat([
    ...(domain ? [createHash('sha256').update(domain).digest()] : []),
    Buffer.from(value),
  ])
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([Buffer.from('v10'), nonce, ciphertext, cipher.getAuthTag()])
}

function chromiumDatabase(schemaVersion = 24) {
  const database = new DatabaseSync(':memory:')
  database.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO meta (key, value) VALUES ('version', '${String(schemaVersion)}');
    CREATE TABLE cookies (
      host_key TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      encrypted_value BLOB NOT NULL,
      path TEXT NOT NULL,
      expires_utc INTEGER NOT NULL,
      is_secure INTEGER NOT NULL,
      is_httponly INTEGER NOT NULL,
      samesite INTEGER NOT NULL,
      top_frame_site_key TEXT NOT NULL
    );
  `)
  return database
}

function insertCookie(
  database: DatabaseSync,
  input: {
    readonly host: string
    readonly name: string
    readonly clearValue?: string
    readonly encryptedValue?: Uint8Array
    readonly partitionKey?: string
  },
) {
  database
    .prepare(`
      INSERT INTO cookies (
        host_key, name, value, encrypted_value, path, expires_utc,
        is_secure, is_httponly, samesite, top_frame_site_key
      ) VALUES (?, ?, ?, ?, '/', 0, 1, 1, 2, ?)
    `)
    .run(
      input.host,
      input.name,
      input.clearValue ?? '',
      input.encryptedValue ?? Buffer.alloc(0),
      input.partitionKey ?? '',
    )
}

describe('Chromium cookie reader', () => {
  it('decrypts macOS/Linux CBC records and checks schema-24 host binding', () => {
    const key = deriveChromiumCbcKey('test-secret', 1_003)
    const bound = cbcValue('session-value', key, 'v10', '.example.test')

    expect(decryptChromiumValue(bound, { cbcV10: key }, '.example.test', 24, 'darwin')).toBe(
      'session-value',
    )
    expect(decryptChromiumValue(bound, { cbcV10: key }, '.other.test', 24, 'darwin')).toBeNull()
    expect(decryptChromiumValue(cbcValue('legacy', key, 'v10'), { cbcV10: key }, '.x.test')).toBe(
      'legacy',
    )
  })

  it('uses Linux v11 and empty-passphrase recovery without widening missing keys', () => {
    const v11 = deriveChromiumCbcKey('linux-secret', 1)
    const empty = deriveChromiumCbcKey('', 1)
    const encrypted = cbcValue('restored', empty, 'v11')

    expect(decryptChromiumValue(encrypted, { cbcV11: v11, cbcEmpty: empty }, 'example.test')).toBe(
      'restored',
    )
    expect(decryptChromiumValue(encrypted, { cbcEmpty: empty }, 'example.test')).toBeNull()
  })

  it('decrypts only legacy Windows v10 GCM and rejects app-bound v20 data', () => {
    const key = Buffer.alloc(32, 0x42)
    const encrypted = gcmValue('windows-session', key, '.example.test')

    expect(decryptChromiumValue(encrypted, { gcmV10: key }, '.example.test', 24, 'win32')).toBe(
      'windows-session',
    )
    expect(
      decryptChromiumValue(Buffer.from('v20opaque'), { gcmV10: key }, '.example.test', 24, 'win32'),
    ).toBeNull()
    expect(
      decryptChromiumValue(Buffer.from('clear'), { gcmV10: key }, '.example.test', 23, 'win32'),
    ).toBeNull()
  })

  it('reads valid rows while skipping partitioned and undecryptable cookies', () => {
    const database = chromiumDatabase()
    const key = deriveChromiumCbcKey('test-secret', 1_003)
    insertCookie(database, {
      host: '.example.test',
      name: 'session',
      encryptedValue: cbcValue('secret', key, 'v10', '.example.test'),
    })
    insertCookie(database, {
      host: 'host.example.test',
      name: '__Host-clear',
      clearValue: 'plain',
    })
    insertCookie(database, {
      host: '.partitioned.test',
      name: 'chips',
      clearValue: 'must-not-widen',
      partitionKey: 'https://top.example',
    })
    insertCookie(database, {
      host: '.broken.test',
      name: 'broken',
      encryptedValue: Buffer.from('v10broken'),
    })

    const result = readChromiumCookieDatabase(database, { cbcV10: key }, 'darwin')

    expect(result.cookies).toEqual([
      {
        url: 'https://example.test/',
        domain: '.example.test',
        name: 'session',
        value: 'secret',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
      },
      {
        url: 'https://host.example.test/',
        name: '__Host-clear',
        value: 'plain',
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
      },
    ])
    expect(result.skipped).toBe(2)
    expect(result.skippedDomains).toEqual(['partitioned.test', 'broken.test'])
    database.close()
  })

  it('surfaces a missing v11 key when it prevents every importable row', () => {
    const database = chromiumDatabase(23)
    insertCookie(database, {
      host: '.example.test',
      name: 'session',
      encryptedValue: Buffer.from('v11opaque'),
    })
    const missing = new BrowserImportError('keychain-item-missing', 'missing')

    expect(() => readChromiumCookieDatabase(database, { cbcV11Error: missing }, 'linux')).toThrow(
      missing,
    )
    database.close()
  })
})
