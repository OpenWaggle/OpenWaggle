import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const renameFailures = vi.hoisted(() => ({ remaining: 0 }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (renameFailures.remaining > 0) {
        renameFailures.remaining -= 1
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return actual.rename(...args)
    },
  }
})

import { createEncryptedMcpToolCatalogCache } from '../runtime/encrypted-tool-catalog-cache'
import { mcpToolCatalogIdentity } from '../runtime/tool-catalog-cache'
import { server, snapshot } from './mcp-runtime-test-utils'

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value),
  decryptString: (value: Buffer) => value.toString(),
}

describe('encrypted MCP tool catalog cache write failures', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-catalog-write-'))
  })

  afterEach(async () => {
    renameFailures.remaining = 0
    await rm(directory, { recursive: true, force: true })
  })

  it('writes an unchanged list again after a failed write', async () => {
    const filePath = path.join(directory, 'tool-catalogs.json')
    const identity = mcpToolCatalogIdentity(snapshot(), server())
    const tools = [{ name: 'search' }]
    const cache = createEncryptedMcpToolCatalogCache({ filePath, encryption })
    renameFailures.remaining = 1

    await cache.write(identity, tools)
    await cache.write(identity, tools)

    const restarted = createEncryptedMcpToolCatalogCache({ filePath, encryption })
    await expect(restarted.read(identity)).resolves.toEqual(tools)
  })
})
