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

function isNamedResource(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string'
  )
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

  it.each([
    ['permission', 'EACCES'],
    ['transient I/O', 'EIO'],
  ])('propagates per-resource %s read failures', async (_description, code) => {
    const resourcePath = path.join(temporaryRoot, 'resource.json')
    await fs.writeFile(resourcePath, JSON.stringify({ name: 'resource' }))
    const readError = new Error(`Resource read failed with ${code}`)
    Object.defineProperty(readError, 'code', { value: code })
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(readError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).rejects.toBe(readError)
  })

  it.each([
    ['permission', 'EACCES'],
    ['transient I/O', 'EIO'],
  ])('propagates per-resource %s stat failures', async (_description, code) => {
    await fs.writeFile(
      path.join(temporaryRoot, 'resource.json'),
      JSON.stringify({ name: 'resource' }),
    )
    const statError = new Error(`Resource stat failed with ${code}`)
    Object.defineProperty(statError, 'code', { value: code })
    vi.spyOn(fs, 'stat').mockRejectedValueOnce(statError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).rejects.toBe(statError)
  })

  it('ignores a resource removed before its metadata read', async () => {
    await fs.writeFile(path.join(temporaryRoot, 'missing.json'), '{}')
    const missingError = new Error('Resource disappeared')
    Object.defineProperty(missingError, 'code', { value: 'ENOENT' })
    vi.spyOn(fs, 'stat').mockRejectedValueOnce(missingError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).resolves.toEqual([])
  })

  it('ignores a resource removed before its content read', async () => {
    await fs.writeFile(path.join(temporaryRoot, 'missing.json'), '{}')
    const missingError = new Error('Resource disappeared')
    Object.defineProperty(missingError, 'code', { value: 'ENOENT' })
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(missingError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).resolves.toEqual([])
  })

  it('ignores malformed JSON and resources that fail validation', async () => {
    await Promise.all([
      fs.writeFile(path.join(temporaryRoot, 'valid.json'), JSON.stringify({ name: 'valid' })),
      fs.writeFile(path.join(temporaryRoot, 'malformed.json'), '{'),
      fs.writeFile(path.join(temporaryRoot, 'invalid.json'), JSON.stringify({ name: 1 })),
    ])

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).resolves.toEqual([
      { name: 'valid' },
    ])
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
