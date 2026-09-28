import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEncryptedMcpToolCatalogCache,
  type McpToolCatalogEncryption,
} from '../runtime/encrypted-tool-catalog-cache'
import { mcpToolCatalogCacheKey } from '../runtime/tool-catalog-cache'
import type { McpRuntimeTool } from '../runtime/types'
import { server, snapshot } from './mcp-runtime-test-utils'

const DAY_MS = 86_400_000
const TOOL: McpRuntimeTool = {
  name: 'search_private_docs',
  description: 'Find a passage in private-project documentation.',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
}

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

describe('encrypted MCP tool catalog cache', () => {
  let directory = ''
  let filePath = ''
  let now = 1_000

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

  it('survives a restart without writing server or tool names in plaintext', async () => {
    const key = mcpToolCatalogCacheKey(snapshot(), server())
    await cache().write(key, [TOOL])

    await expect(cache().read(key)).resolves.toEqual([TOOL])
    const contents = await readFile(filePath, 'utf8')
    expect(contents).not.toContain('search_private_docs')
    expect(contents).not.toContain('private-docs-server')
    expect(contents).not.toContain('/project')
  })

  it('keys a catalog by project, server identity and configuration', () => {
    const base = mcpToolCatalogCacheKey(snapshot(), server())
    expect(mcpToolCatalogCacheKey(snapshot({ sessionId: 'other-session' }), server())).toBe(base)
    expect(mcpToolCatalogCacheKey(snapshot({ executionPath: '/worktree' }), server())).toBe(base)
    expect(mcpToolCatalogCacheKey(snapshot(), server({ configHash: 'config-2' }))).not.toBe(base)
    expect(mcpToolCatalogCacheKey(snapshot({ projectPath: '/other' }), server())).not.toBe(base)
    expect(mcpToolCatalogCacheKey(snapshot(), server({ instanceId: 'server-2' }))).not.toBe(base)
  })

  it('forgets a catalog once it is older than the retention window', async () => {
    const key = mcpToolCatalogCacheKey(snapshot(), server())
    await cache().write(key, [TOOL])
    now += 8 * DAY_MS

    await expect(cache().read(key)).resolves.toBeUndefined()
  })

  it('keeps entries another app sealed with a key it cannot read', async () => {
    const key = mcpToolCatalogCacheKey(snapshot(), server())
    const otherKey = mcpToolCatalogCacheKey(snapshot(), server({ instanceId: 'server-2' }))
    await cache(fakeEncryption('dev:')).write(otherKey, [TOOL])

    await cache().write(key, [TOOL])

    await expect(cache().read(otherKey)).resolves.toBeUndefined()
    await expect(cache(fakeEncryption('dev:')).read(otherKey)).resolves.toEqual([TOOL])
  })

  it('treats a corrupt file as empty and replaces it on the next write', async () => {
    const key = mcpToolCatalogCacheKey(snapshot(), server())
    await writeFile(filePath, '{not json')

    await expect(cache().read(key)).resolves.toBeUndefined()
    await cache().write(key, [TOOL])
    await expect(cache().read(key)).resolves.toEqual([TOOL])
  })

  it('stays in memory only when OS encryption is unavailable', async () => {
    const key = mcpToolCatalogCacheKey(snapshot(), server())
    const unavailable = { ...fakeEncryption(), isEncryptionAvailable: () => false }
    const memoryOnly = cache(unavailable)

    await memoryOnly.write(key, [TOOL])

    await expect(memoryOnly.read(key)).resolves.toEqual([TOOL])
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
