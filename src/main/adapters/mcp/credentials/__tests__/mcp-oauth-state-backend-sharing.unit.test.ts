import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import lockfile from 'proper-lockfile'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMcpOAuthStateBackend, type McpOAuthEncryption } from '../mcp-oauth-state-backend'

let root: string
let storePath: string
let decrypt: ReturnType<typeof vi.fn<(value: Buffer) => string>>
let encryption: McpOAuthEncryption

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-oauth-sharing-'))
  storePath = path.join(root, 'user-data', 'mcp', 'oauth-states.json')
  decrypt = vi.fn((value: Buffer) => value.toString().replace(/^sealed:/, ''))
  encryption = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`sealed:${value}`),
    decryptString: decrypt,
  }
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function backend(lockWaitMs?: number) {
  return createMcpOAuthStateBackend({
    piAuthPath: path.join(root, 'pi', 'mcp-auth.json'),
    storePath,
    encryption,
    ...(lockWaitMs === undefined ? {} : { lockWaitMs }),
  })
}

function read(store: ReturnType<typeof backend>) {
  return store.withLock((current) => ({
    result: current === undefined ? {} : JSON.parse(current),
  }))
}

function put(store: ReturnType<typeof backend>, key: string) {
  store.withLock((current) => {
    const states = current === undefined ? {} : JSON.parse(current)
    return { result: undefined, next: JSON.stringify({ ...states, [key]: true }) }
  })
}

describe('the MCP sign-in store shared by processes', () => {
  it('decrypts the store only when another process changed it', () => {
    const host = backend()
    put(host, 'a')
    decrypt.mockClear()

    read(host)
    read(host)
    read(host)
    // What this process wrote is known without decrypting it again.
    expect(decrypt).not.toHaveBeenCalled()
    expect(read(backend())).toEqual({ a: true })
    expect(decrypt).toHaveBeenCalledTimes(1)

    put(backend(), 'b')
    // Whatever the file system's timestamp resolution, the change is seen.
    utimesSync(storePath, new Date(), new Date(Date.now() + 1_000))
    decrypt.mockClear()
    expect(read(host)).toEqual({ a: true, b: true })
    expect(decrypt).toHaveBeenCalledTimes(1)
  })

  it('keeps a sign-in another process saved while this one was refreshing', async () => {
    const host = backend()
    const cli = backend()
    put(host, 'a')

    await host.withLockAsync(async (current) => {
      const states = current === undefined ? {} : JSON.parse(current)
      // Another process signs in to another server while this refresh waits on the network.
      put(cli, 'b')
      return { result: undefined, next: JSON.stringify({ ...states, a: 'refreshed' }) }
    })

    expect(read(backend())).toEqual({ a: 'refreshed', b: true })
  })

  it('does not write while another process holds the store lock', () => {
    const host = backend(50)
    put(host, 'a')
    const release = lockfile.lockSync(storePath, { realpath: false })
    try {
      expect(() => put(host, 'b')).toThrow('another process')
    } finally {
      release()
    }
    expect(read(host)).toEqual({ a: true })
  })

  it("never writes the shared store's copy over a store another process created meanwhile", () => {
    const legacyStorePath = path.join(root, 'shared', 'mcp', 'oauth-states.json')
    const shared = createMcpOAuthStateBackend({
      piAuthPath: path.join(root, 'pi', 'mcp-auth.json'),
      storePath: legacyStorePath,
      encryption,
    })
    put(shared, 'old')
    const taking = createMcpOAuthStateBackend({
      piAuthPath: path.join(root, 'pi', 'mcp-auth.json'),
      storePath,
      legacyStorePath,
      encryption,
    })
    // While this process decrypts the shared store, another one of this build signs in.
    decrypt.mockImplementationOnce((value: Buffer) => {
      put(backend(), 'new')
      return value.toString().replace(/^sealed:/, '')
    })

    read(taking)

    expect(read(backend())).toEqual({ new: true })
  })
})
