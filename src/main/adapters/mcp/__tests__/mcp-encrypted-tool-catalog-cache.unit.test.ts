import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEncryptedMcpToolCatalogCache,
  type McpToolCatalogEncryption,
} from '../runtime/encrypted-tool-catalog-cache'
import { mcpToolCatalogIdentity } from '../runtime/tool-catalog-cache'
import type { McpRuntimeTool } from '../runtime/types'
import { server, snapshot } from './mcp-runtime-test-utils'

const DAY_MS = 86_400_000
const TOOL: McpRuntimeTool = {
  name: 'search_private_docs',
  description: 'Find a passage in private-project documentation.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
}
const OTHER_SERVER = server({ instanceId: 'server-2' })

/** Reversible stand-in for OS encryption, so a test can tell ciphertext from plaintext. */
function fakeEncryption(prefix = 'sealed:'): McpToolCatalogEncryption {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`${prefix}${Buffer.from(value).toString('base64')}`),
    decryptString: (value) => {
      const text = value.toString()
      if (!text.startsWith(prefix)) throw new Error('Cannot decrypt with this key.')
      return Buffer.from(text.slice(prefix.length), 'base64').toString()
    },
  }
}

async function readJson(filePath: string): Promise<{
  version: number
  entries: Record<string, { updatedAt: number; server: string; sealed: string }>
}> {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

describe('encrypted MCP tool catalog cache', () => {
  let directory = ''
  let filePath = ''
  let now = 1_000
  const identity = mcpToolCatalogIdentity(snapshot(), server())
  const otherIdentity = mcpToolCatalogIdentity(snapshot(), OTHER_SERVER)

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-catalog-'))
    filePath = path.join(directory, 'tool-catalogs.json')
    now = 1_000
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function cache(encryption = fakeEncryption()) {
    return createEncryptedMcpToolCatalogCache({ filePath, encryption, now: () => now })
  }

  it('survives a restart without writing server, tool or project names in plaintext', async () => {
    await cache().write(identity, [TOOL])

    await expect(cache().read(identity)).resolves.toEqual([TOOL])
    const contents = await readFile(filePath, 'utf8')
    expect(contents).not.toContain('search_private_docs')
    expect(contents).not.toContain('server-1')
    expect(contents).not.toContain('/project')
  })

  it('keeps the cache directory and file private to the user', async () => {
    filePath = path.join(directory, 'mcp', 'tool-catalogs.json')
    await cache().write(identity, [TOOL])

    expect((await stat(path.dirname(filePath))).mode & 0o777).toBe(0o700)
    expect((await stat(filePath)).mode & 0o777).toBe(0o600)
  })

  it('keys a catalog by project, server identity and configuration', () => {
    const base = identity.key
    const key = (...args: Parameters<typeof mcpToolCatalogIdentity>) =>
      mcpToolCatalogIdentity(...args).key
    expect(key(snapshot({ sessionId: 'other-session' }), server())).toBe(base)
    expect(key(snapshot({ executionPath: '/worktree' }), server())).toBe(base)
    expect(key(snapshot(), server({ configHash: 'config-2' }))).not.toBe(base)
    expect(key(snapshot({ projectPath: '/other' }), server())).not.toBe(base)
    expect(key(snapshot(), OTHER_SERVER)).not.toBe(base)
    expect(key(snapshot(), server({ allowUnsandboxed: true }))).not.toBe(base)
  })

  it('forgets a catalog once it is older than the retention window', async () => {
    await cache().write(identity, [TOOL])
    now += 8 * DAY_MS

    await expect(cache().read(identity)).resolves.toBeUndefined()
  })

  it('removes aged-out entries from disk the first time a process uses the cache', async () => {
    await cache().write(identity, [TOOL])
    now += 8 * DAY_MS
    await cache().write(otherIdentity, [TOOL])

    expect(Object.keys((await readJson(filePath)).entries)).toEqual([otherIdentity.key])
  })

  it('keeps a list in daily use by re-sealing it once a day even when unchanged', async () => {
    await cache().write(identity, [TOOL])
    now += 6 * DAY_MS
    const restarted = cache()
    await restarted.read(identity)
    await restarted.write(identity, [TOOL])
    now += 4 * DAY_MS

    await expect(cache().read(identity)).resolves.toEqual([TOOL])
  })

  it('forgets every list of a server without opening the others', async () => {
    const otherProject = mcpToolCatalogIdentity(snapshot({ projectPath: '/other' }), server())
    await cache().write(identity, [TOOL])
    await cache().write(otherProject, [TOOL])
    await cache().write(otherIdentity, [TOOL])

    await cache().forgetServer('server-1')

    await expect(cache().read(identity)).resolves.toBeUndefined()
    await expect(cache().read(otherProject)).resolves.toBeUndefined()
    await expect(cache().read(otherIdentity)).resolves.toEqual([TOOL])
  })

  it('keeps a list forgotten while a read of the old file was under way', async () => {
    await cache().write(identity, [TOOL])
    const fresh = cache()

    const reading = fresh.read(identity)
    await fresh.forgetServer('server-1')
    await reading

    await expect(fresh.read(identity)).resolves.toBeUndefined()
  })

  it('does not open a sealed list moved under another key', async () => {
    await cache().write(identity, [TOOL])
    const file = await readJson(filePath)
    const entry = file.entries[identity.key]
    if (!entry) throw new Error('Expected a sealed entry.')
    await writeFile(
      filePath,
      JSON.stringify({ version: 1, entries: { [otherIdentity.key]: entry } }),
    )

    await expect(cache().read(otherIdentity)).resolves.toBeUndefined()
  })

  it('reads a list another install sealed as a miss and keeps it', async () => {
    await cache(fakeEncryption('other-install:')).write(otherIdentity, [TOOL])

    await cache().write(identity, [TOOL])

    await expect(cache().read(otherIdentity)).resolves.toBeUndefined()
    await expect(cache(fakeEncryption('other-install:')).read(otherIdentity)).resolves.toEqual([
      TOOL,
    ])
  })

  it('treats a corrupt file as empty and replaces it on the next write', async () => {
    await writeFile(filePath, '{not json')

    await expect(cache().read(identity)).resolves.toBeUndefined()
    await cache().write(identity, [TOOL])
    await expect(cache().read(identity)).resolves.toEqual([TOOL])
  })

  it('leaves a file from a newer OpenWaggle alone', async () => {
    const newer = JSON.stringify({ version: 99, entries: {} })
    await writeFile(filePath, newer)

    await cache().write(identity, [TOOL])

    expect(await readFile(filePath, 'utf8')).toBe(newer)
  })

  it('does not open a list whose input schema is not an object', async () => {
    const malformed = { name: 'broken', inputSchema: 'not a schema' }
    const sealed = fakeEncryption()
      .encryptString(JSON.stringify({ key: identity.key, tools: [malformed] }))
      .toString('base64')
    const entry = { updatedAt: now, server: 'tag', sealed }
    await writeFile(filePath, JSON.stringify({ version: 1, entries: { [identity.key]: entry } }))

    await expect(cache().read(identity)).resolves.toBeUndefined()
  })

  it('does not write a list over the size limit', async () => {
    const huge: McpRuntimeTool = { name: 'huge', description: 'x'.repeat(2_200_000) }

    await cache().write(identity, [huge])

    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stays in memory only when OS encryption is unavailable', async () => {
    const unavailable = { ...fakeEncryption(), isEncryptionAvailable: () => false }
    const memoryOnly = cache(unavailable)

    await memoryOnly.write(identity, [TOOL])

    await expect(memoryOnly.read(identity)).resolves.toEqual([TOOL])
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
