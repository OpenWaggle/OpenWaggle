import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpOAuthStateBackend, type McpOAuthEncryption } from '../mcp-oauth-state-backend'

/** Each build seals with its own key; a value sealed by another key cannot be opened. */
function keyedEncryption(key: string): McpOAuthEncryption {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`${key}:${value}`),
    decryptString: (value) => {
      const text = value.toString()
      if (!text.startsWith(`${key}:`)) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.')
      }
      return text.slice(key.length + 1)
    },
  }
}

const RELEASE = keyedEncryption('release')
const DEV = keyedEncryption('dev')
const SIGN_IN = { 'mcp__docs|https://docs.example/mcp': { tokens: { access_token: 'a' } } }

let root: string
let piAuthPath: string
let legacyStorePath: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-oauth-keys-'))
  piAuthPath = path.join(root, 'home', '.pi', 'agent', 'mcp-auth.json')
  legacyStorePath = path.join(root, 'home', '.openwaggle', 'mcp', 'oauth-states.json')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function storeIn(build: string) {
  return path.join(root, build, 'mcp', 'oauth-states.json')
}

function backendFor(build: string, encryption: McpOAuthEncryption, warnings: string[] = []) {
  return createMcpOAuthStateBackend({
    piAuthPath,
    storePath: storeIn(build),
    legacyStorePath,
    encryption,
    onWarning: (message) => warnings.push(message),
  })
}

function read(backend: ReturnType<typeof createMcpOAuthStateBackend>) {
  return backend.withLock((current) => ({
    result: current === undefined ? {} : JSON.parse(current),
  }))
}

function signIn(backend: ReturnType<typeof createMcpOAuthStateBackend>) {
  backend.withLock(() => ({ result: undefined, next: JSON.stringify(SIGN_IN) }))
}

function sealedStore(encryption: McpOAuthEncryption, states: unknown) {
  const encrypted = encryption
    .encryptString(JSON.stringify({ states, tombstones: {} }))
    .toString('base64')
  return JSON.stringify({ version: 1, encrypted })
}

describe('MCP sign-ins per build', () => {
  it('keeps a dev and a release build from touching each other’s sign-ins', () => {
    signIn(backendFor('release', RELEASE))
    signIn(backendFor('dev', DEV))

    expect(read(backendFor('release', RELEASE))).toEqual(SIGN_IN)
    expect(read(backendFor('dev', DEV))).toEqual(SIGN_IN)
  })

  it('leaves a store it cannot decrypt in place and refuses to overwrite it', () => {
    mkdirSync(path.dirname(storeIn('release')), { recursive: true })
    const sealed = sealedStore(RELEASE, SIGN_IN)
    writeFileSync(storeIn('release'), sealed)
    // A keychain that briefly refuses: this read sees no sign-ins of its own, and saves nothing.
    const backend = backendFor('release', DEV)

    expect(read(backend)).toEqual({})
    expect(() => signIn(backend)).toThrow('cannot be decrypted')
    expect(readFileSync(storeIn('release'), 'utf8')).toBe(sealed)
    expect(read(backendFor('release', RELEASE))).toEqual(SIGN_IN)
  })

  it('moves the shared pre-build store over once, for the build that can open it', () => {
    mkdirSync(path.dirname(legacyStorePath), { recursive: true })
    const legacy = sealedStore(RELEASE, SIGN_IN)
    writeFileSync(legacyStorePath, legacy)

    expect(read(backendFor('dev', DEV))).toEqual({})
    expect(existsSync(storeIn('dev'))).toBe(false)
    expect(read(backendFor('release', RELEASE))).toEqual(SIGN_IN)
    expect(readFileSync(storeIn('release'), 'utf8')).toBe(legacy)
    // The old file stays for any other build, and is not read again once copied.
    expect(readFileSync(legacyStorePath, 'utf8')).toBe(legacy)
    writeFileSync(legacyStorePath, sealedStore(RELEASE, {}))
    expect(read(backendFor('release', RELEASE))).toEqual(SIGN_IN)
  })

  it('tries the shared store again after a read that could not finish', () => {
    mkdirSync(path.dirname(legacyStorePath), { recursive: true })
    writeFileSync(legacyStorePath, sealedStore(RELEASE, SIGN_IN))
    const backend = backendFor('release', RELEASE)
    // Unreadable for now, for example while a backup tool holds it.
    chmodSync(legacyStorePath, 0o000)

    expect(read(backend)).toEqual({})
    // A sign-in saved now would create this build's store and hide the old ones for good.
    expect(() => signIn(backend)).toThrow('cannot be decrypted')
    chmodSync(legacyStorePath, 0o600)

    expect(read(backend)).toEqual(SIGN_IN)
    expect(existsSync(storeIn('release'))).toBe(true)
  })
})
