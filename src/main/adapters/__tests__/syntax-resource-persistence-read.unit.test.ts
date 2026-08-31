import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALLED_RESOURCE_CATALOG_MAX_BYTES,
  readPersistedResources,
} from '../syntax-resource-persistence-read'

function isResource(_value: unknown): _value is unknown {
  return true
}

describe('installed syntax resource reads', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-syntax-read-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('treats a missing resource directory as an empty library', async () => {
    await expect(
      readPersistedResources(path.join(temporaryRoot, 'missing'), isResource),
    ).resolves.toEqual([])
  })

  it('propagates resource directory read failures', async () => {
    const permissionError = new Error('Permission denied')
    Object.defineProperty(permissionError, 'code', { value: 'EACCES' })
    vi.spyOn(fs, 'readdir').mockRejectedValueOnce(permissionError)

    await expect(readPersistedResources(temporaryRoot, isResource)).rejects.toBe(permissionError)
  })

  it('rejects a catalog before reading beyond its aggregate byte budget', async () => {
    await fs.writeFile(
      path.join(temporaryRoot, 'oversized.json'),
      'x'.repeat(INSTALLED_RESOURCE_CATALOG_MAX_BYTES + 1),
    )

    await expect(readPersistedResources(temporaryRoot, isResource)).rejects.toThrow(
      'aggregate byte limit',
    )
  })
})
