import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpOAuthStateBackend, type McpOAuthEncryption } from '../mcp-oauth-state-backend'

let root: string
let piAuthPath: string
let storePath: string

const encryption: McpOAuthEncryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`sealed:${value}`),
  decryptString: (value) => value.toString().replace(/^sealed:/, ''),
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-oauth-'))
  piAuthPath = path.join(root, '.pi', 'agent', 'mcp-auth.json')
  storePath = path.join(root, '.openwaggle', 'mcp', 'oauth-states.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function writePi(states: Record<string, unknown>) {
  mkdirSync(path.dirname(piAuthPath), { recursive: true })
  writeFileSync(piAuthPath, JSON.stringify(states))
}

function piText() {
  return readFileSync(piAuthPath, 'utf8')
}

function read(backend: ReturnType<typeof createMcpOAuthStateBackend>) {
  return backend.withLock((current) => ({
    result: current === undefined ? {} : JSON.parse(current),
  }))
}

function update(
  backend: ReturnType<typeof createMcpOAuthStateBackend>,
  change: (states: Record<string, unknown>) => void,
) {
  backend.withLock((current) => {
    const states: Record<string, unknown> = current === undefined ? {} : JSON.parse(current)
    change(states)
    return { result: undefined, next: JSON.stringify(states) }
  })
}

describe('MCP OAuth state backend', () => {
  it("falls back to Pi's sign-ins and keeps OpenWaggle's own first", () => {
    writePi({
      'mcp__sentry|https://s': { tokens: { access_token: 'pi' } },
      'mcp__other|https://o': { tokens: { access_token: 'o' } },
    })
    const backend = createMcpOAuthStateBackend({ piAuthPath, storePath, encryption })

    update(backend, (states) => {
      states['mcp__sentry|https://s'] = { tokens: { access_token: 'refreshed' } }
    })

    expect(read(backend)).toEqual({
      'mcp__sentry|https://s': { tokens: { access_token: 'refreshed' } },
      'mcp__other|https://o': { tokens: { access_token: 'o' } },
    })
  })

  it("never writes Pi's file, and stores OpenWaggle's states encrypted", () => {
    writePi({ 'mcp__a|https://a': { tokens: { access_token: 'pi' } } })
    const before = piText()
    const backend = createMcpOAuthStateBackend({ piAuthPath, storePath, encryption })

    update(backend, (states) => {
      states['mcp__b|https://b'] = { tokens: { access_token: 'secret-token' } }
    })

    expect(piText()).toBe(before)
    const stored = readFileSync(storePath, 'utf8')
    expect(stored).not.toContain('secret-token')
    expect(JSON.parse(stored)).toEqual({ version: 1, encrypted: expect.any(String) })
  })

  it("hides a signed-out Pi sign-in until Pi's file changes it", () => {
    writePi({ 'mcp__a|https://a': { tokens: { access_token: 'old' } } })
    const backend = createMcpOAuthStateBackend({ piAuthPath, storePath, encryption })

    update(backend, (states) => {
      delete states['mcp__a|https://a']
    })
    expect(read(backend)).toEqual({})

    writePi({ 'mcp__a|https://a': { tokens: { access_token: 'signed in again with pi' } } })
    expect(read(backend)).toEqual({
      'mcp__a|https://a': { tokens: { access_token: 'signed in again with pi' } },
    })
  })

  it('removes a key OpenWaggle stored itself', () => {
    const backend = createMcpOAuthStateBackend({ piAuthPath, storePath, encryption })
    update(backend, (states) => {
      states['mcp__a|https://a'] = { tokens: { access_token: 'x' } }
    })

    update(backend, (states) => {
      delete states['mcp__a|https://a']
    })

    expect(read(backend)).toEqual({})
  })

  it('keeps sign-ins in memory only when OS encryption is unavailable', () => {
    const warnings: string[] = []
    const backend = createMcpOAuthStateBackend({
      piAuthPath,
      storePath,
      encryption: { ...encryption, isEncryptionAvailable: () => false },
      onWarning: (message) => warnings.push(message),
    })

    update(backend, (states) => {
      states.k = { tokens: { access_token: 'memory' } }
    })

    expect(read(backend)).toEqual({ k: { tokens: { access_token: 'memory' } } })
    expect(() => readFileSync(storePath)).toThrow()
    expect(warnings).toHaveLength(1)
  })

  it('serializes asynchronous updates', async () => {
    const backend = createMcpOAuthStateBackend({ piAuthPath, storePath, encryption })
    const add = (key: string) =>
      backend.withLockAsync(async (current) => {
        const states: Record<string, unknown> = current === undefined ? {} : JSON.parse(current)
        await Promise.resolve()
        states[key] = true
        return { result: key, next: JSON.stringify(states) }
      })

    await Promise.all([add('a'), add('b')])

    expect(read(backend)).toEqual({ a: true, b: true })
  })

  it('moves an undecryptable store aside, starts fresh, and says so once', () => {
    writePi({ 'mcp__docs|https://docs.example/mcp': { serverUrl: 'https://docs.example/mcp' } })
    mkdirSync(path.dirname(storePath), { recursive: true })
    // Sealed by another key (a reinstalled OS keychain, a copied home folder).
    writeFileSync(storePath, JSON.stringify({ version: 1, encrypted: 'bm90LXNlYWxlZA==' }))
    const warnings: string[] = []
    const backend = createMcpOAuthStateBackend({
      piAuthPath,
      storePath,
      encryption: {
        ...encryption,
        decryptString: () => {
          throw new Error(
            'Error while decrypting the ciphertext provided to safeStorage.decryptString.',
          )
        },
      },
      onWarning: (message) => warnings.push(message),
    })

    expect(read(backend)).toEqual({
      'mcp__docs|https://docs.example/mcp': { serverUrl: 'https://docs.example/mcp' },
    })
    expect(read(backend)).toEqual({
      'mcp__docs|https://docs.example/mcp': { serverUrl: 'https://docs.example/mcp' },
    })

    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('could not be read')
    const kept = readdirSync(path.dirname(storePath)).filter((name) => name.includes('unreadable'))
    expect(kept).toHaveLength(1)
    expect(existsSync(storePath)).toBe(false)
  })
})
