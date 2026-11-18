import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SyntaxThemeResource } from '@shared/types/syntax-resources'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALLED_RESOURCE_CATALOG_MAX_BYTES,
  isSyntaxThemeResource,
  readPersistedResources,
} from '../syntax-resource-persistence-read'

const VALID_THEME_RESOURCE = {
  id: 'theme:user:test:dark',
  packageId: 'user:test',
  revision: 'revision-1',
  label: 'Test theme',
  variant: 'dark',
  scope: 'user',
  format: 'vscode-json',
  sourcePath: '/tmp/test-theme.json',
  theme: {
    name: 'theme:user:test:dark:revision-1',
    displayName: 'Test theme',
    type: 'dark',
    colors: { 'editor.background': '#101010' },
    settings: [
      {
        name: 'Variables',
        scope: ['variable', 'support.variable'],
        settings: { foreground: '#eeeeee', fontStyle: 'italic' },
      },
    ],
  },
  original: {},
} satisfies SyntaxThemeResource

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
  ])('propagates per-resource %s open failures', async (_description, code) => {
    const resourcePath = path.join(temporaryRoot, 'resource.json')
    await fs.writeFile(resourcePath, JSON.stringify({ name: 'resource' }))
    const readError = new Error(`Resource read failed with ${code}`)
    Object.defineProperty(readError, 'code', { value: code })
    vi.spyOn(fs, 'open').mockRejectedValueOnce(readError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).rejects.toBe(readError)
  })

  it.each([
    ['permission', 'EACCES'],
    ['transient I/O', 'EIO'],
  ])('propagates per-resource %s metadata failures', async (_description, code) => {
    await fs.writeFile(
      path.join(temporaryRoot, 'resource.json'),
      JSON.stringify({ name: 'resource' }),
    )
    const statError = new Error(`Resource stat failed with ${code}`)
    Object.defineProperty(statError, 'code', { value: code })
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce(statError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).rejects.toBe(statError)
  })

  it('ignores a resource removed before its metadata read', async () => {
    await fs.writeFile(path.join(temporaryRoot, 'missing.json'), '{}')
    const missingError = new Error('Resource disappeared')
    Object.defineProperty(missingError, 'code', { value: 'ENOENT' })
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce(missingError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).resolves.toEqual([])
  })

  it('ignores a resource removed before its content read', async () => {
    await fs.writeFile(path.join(temporaryRoot, 'missing.json'), '{}')
    const missingError = new Error('Resource disappeared')
    Object.defineProperty(missingError, 'code', { value: 'ENOENT' })
    vi.spyOn(fs, 'open').mockRejectedValueOnce(missingError)

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).resolves.toEqual([])
  })

  it('ignores malformed JSON and resources that fail validation', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await Promise.all([
      fs.writeFile(path.join(temporaryRoot, 'valid.json'), JSON.stringify({ name: 'valid' })),
      fs.writeFile(path.join(temporaryRoot, 'malformed.json'), '{'),
      fs.writeFile(path.join(temporaryRoot, 'invalid.json'), JSON.stringify({ name: 1 })),
    ])

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).resolves.toEqual([
      { name: 'valid' },
    ])
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('[syntax-resource-persistence] Ignored malformed'),
      expect.objectContaining({ resourcePath: path.join(temporaryRoot, 'malformed.json') }),
    )
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('[syntax-resource-persistence] Ignored invalid'),
      { resourcePath: path.join(temporaryRoot, 'invalid.json') },
    )
  })

  it('accepts complete persisted theme resources', () => {
    expect(isSyntaxThemeResource(VALID_THEME_RESOURCE)).toBe(true)
  })

  it.each([
    [
      'missing token settings',
      { ...VALID_THEME_RESOURCE, theme: { ...VALID_THEME_RESOURCE.theme, settings: undefined } },
    ],
    ['invalid variant', { ...VALID_THEME_RESOURCE, variant: 'dim' }],
    ['invalid scope', { ...VALID_THEME_RESOURCE, scope: 'workspace' }],
    [
      'invalid theme colors',
      {
        ...VALID_THEME_RESOURCE,
        theme: { ...VALID_THEME_RESOURCE.theme, colors: { 'editor.background': 10 } },
      },
    ],
    [
      'invalid token rule',
      {
        ...VALID_THEME_RESOURCE,
        theme: {
          ...VALID_THEME_RESOURCE.theme,
          settings: [{ scope: 42, settings: { foreground: '#eeeeee' } }],
        },
      },
    ],
  ])('rejects a persisted theme with %s', (_description, resource) => {
    expect(isSyntaxThemeResource(resource)).toBe(false)
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

  it.skipIf(process.platform === 'win32')('rejects symlinked resource files', async () => {
    const targetPath = path.join(temporaryRoot, 'target')
    await fs.writeFile(targetPath, JSON.stringify({ name: 'resource' }))
    await fs.symlink(targetPath, path.join(temporaryRoot, 'resource.json'))

    await expect(readPersistedResources(temporaryRoot, isNamedResource)).rejects.toThrow(
      'must be a regular file',
    )
  })

  it('enforces the remaining budget when a file grows after metadata inspection', async () => {
    await fs.writeFile(path.join(temporaryRoot, 'resource.json'), '{}')
    const close = vi.fn()
    const read = vi
      .fn()
      .mockResolvedValueOnce({ bytesRead: 2, buffer: Buffer.alloc(2) })
      .mockResolvedValueOnce({ bytesRead: 1, buffer: Buffer.alloc(1) })
    vi.spyOn(fs, 'open').mockResolvedValueOnce(
      fromPartial({
        close,
        read,
        stat: vi.fn().mockResolvedValue(
          fromPartial({
            isFile: () => true,
            size: 0,
          }),
        ),
      }),
    )

    await expect(
      readPersistedResources(temporaryRoot, isResource, { remainingBytes: 2 }),
    ).rejects.toThrow('aggregate byte limit')
    expect(close).toHaveBeenCalledOnce()
  })
})
