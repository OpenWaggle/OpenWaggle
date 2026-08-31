import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SyntaxResourceCatalog, SyntaxThemeResource } from '@shared/types/syntax-resources'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PROJECT_CATALOG_MAX_BYTES,
  readProjectSyntaxCatalog,
  type SyntaxSourceParser,
} from '../syntax-resource-project-catalog'

const EMPTY_CATALOG = {
  themes: [],
  languages: [],
  appearances: [],
} satisfies SyntaxResourceCatalog

function projectTheme(index: number): SyntaxThemeResource {
  return {
    id: `project:${String(index)}`,
    packageId: 'project.capacity',
    revision: String(index),
    label: `Project ${String(index)}`,
    variant: 'dark',
    scope: 'project',
    format: 'openwaggle',
    sourcePath: `/project/${String(index)}.json`,
    theme: {
      name: `project-${String(index)}`,
      displayName: `Project ${String(index)}`,
      type: 'dark',
      colors: {},
      settings: [],
    },
    original: {},
  }
}

describe('project syntax catalog capacity', () => {
  let projectPath = ''

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-project-syntax-capacity-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  async function sparseResource(relativePath: string, size: number) {
    const resourcePath = path.join(projectPath, relativePath)
    await fs.mkdir(path.dirname(resourcePath), { recursive: true })
    await fs.writeFile(resourcePath, '')
    await fs.truncate(resourcePath, size)
    return resourcePath
  }

  it('allows project inputs whose aggregate size exactly matches the byte limit', async () => {
    await Promise.all([
      sparseResource('.openwaggle/themes/near-limit.json', PROJECT_CATALOG_MAX_BYTES - 1),
      sparseResource('.openwaggle/languages/final-byte.json', 1),
    ])
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).resolves.toEqual(EMPTY_CATALOG)
    expect(parseSource).toHaveBeenCalledTimes(2)
  })

  it('stops preflight before later resources and parses nothing when input bytes exceed the limit', async () => {
    const nearLimitPath = await sparseResource(
      '.openwaggle/themes/near-limit.json',
      PROJECT_CATALOG_MAX_BYTES,
    )
    const overflowPath = await sparseResource('.openwaggle/languages/overflow.json', 1)
    const unreadPath = await sparseResource('.openwaggle/syntax/unread.json', 1)
    const [nearLimitRealPath, overflowRealPath, unreadRealPath] = await Promise.all([
      fs.realpath(nearLimitPath),
      fs.realpath(overflowPath),
      fs.realpath(unreadPath),
    ])
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)
    const lstat = vi.spyOn(fs, 'lstat')

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).rejects.toThrow(
      'aggregate byte limit',
    )
    expect(parseSource).not.toHaveBeenCalled()
    expect(lstat).toHaveBeenCalledTimes(2)
    expect(lstat).toHaveBeenNthCalledWith(1, nearLimitRealPath)
    expect(lstat).toHaveBeenNthCalledWith(2, overflowRealPath)
    expect(lstat).not.toHaveBeenCalledWith(unreadRealPath)
  })

  it('counts nested files in an unpacked extension before invoking its parser', async () => {
    await Promise.all([
      sparseResource(
        '.openwaggle/themes/oversized-extension/package.json',
        Math.floor(PROJECT_CATALOG_MAX_BYTES / 2),
      ),
      sparseResource(
        '.openwaggle/themes/oversized-extension/themes/dark.json',
        Math.floor(PROJECT_CATALOG_MAX_BYTES / 2) + 1,
      ),
    ])
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).rejects.toThrow(
      'aggregate byte limit',
    )
    expect(parseSource).not.toHaveBeenCalled()
  })

  it('does not follow symlinks outside an unpacked extension during preflight', async () => {
    const outsidePath = await sparseResource('outside.json', PROJECT_CATALOG_MAX_BYTES + 1)
    const extensionPath = path.join(projectPath, '.openwaggle', 'themes', 'confined-extension')
    await fs.mkdir(extensionPath, { recursive: true })
    await fs.writeFile(path.join(extensionPath, 'package.json'), '{}')
    await fs.symlink(outsidePath, path.join(extensionPath, 'outside-link.json'))
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).resolves.toEqual(EMPTY_CATALOG)
    expect(parseSource).toHaveBeenCalledTimes(1)
  })

  it('bounds zero-byte entries in unpacked extensions before parsing', async () => {
    const extensionPath = path.join(projectPath, '.openwaggle', 'themes', 'entry-heavy-extension')
    await fs.mkdir(extensionPath, { recursive: true })
    await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        fs.writeFile(path.join(extensionPath, `empty-${String(index)}.json`), ''),
      ),
    )
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).rejects.toThrow(
      'aggregate entry limit',
    )
    expect(parseSource).not.toHaveBeenCalled()
  })

  it('bounds directory depth in unpacked extensions before parsing', async () => {
    const extensionPath = path.join(projectPath, '.openwaggle', 'themes', 'deep-extension')
    const nestedPath = path.join(extensionPath, ...Array.from({ length: 65 }, () => 'nested'))
    await fs.mkdir(nestedPath, { recursive: true })
    const parseSource: SyntaxSourceParser = vi.fn(async () => EMPTY_CATALOG)

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).rejects.toThrow(
      'aggregate depth limit',
    )
    expect(parseSource).not.toHaveBeenCalled()
  })

  it('propagates aggregate parsed-catalog capacity errors', async () => {
    await sparseResource('.openwaggle/themes/catalog.json', 1)
    const parseSource: SyntaxSourceParser = vi.fn(async () => ({
      themes: Array.from({ length: 201 }, (_, index) => projectTheme(index)),
      languages: [],
      appearances: [],
    }))

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).rejects.toThrow(
      'aggregate catalog limit',
    )
  })

  it('continues past malformed resources while keeping capacity errors outside that recovery path', async () => {
    await Promise.all([
      sparseResource('.openwaggle/themes/malformed.json', 1),
      sparseResource('.openwaggle/languages/valid.json', 1),
    ])
    let calls = 0
    const parseSource: SyntaxSourceParser = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('Malformed project resource')
      return EMPTY_CATALOG
    })

    await expect(readProjectSyntaxCatalog(projectPath, parseSource)).resolves.toEqual(EMPTY_CATALOG)
    expect(parseSource).toHaveBeenCalledTimes(2)
  })
})
