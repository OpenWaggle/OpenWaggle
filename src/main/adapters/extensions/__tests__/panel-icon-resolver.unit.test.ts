import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SVG_ICON_MAX_BYTES } from '../../../domain/extension-panel-icon/svg-icon-sanitizer'
import type { ExtensionPanelIconRequest } from '../../../ports/extension-panel-icon-resolver'
import { createLucideCatalogLoader, lucideExportName } from '../lucide-panel-icon'
import {
  createExtensionPanelIconResolver,
  type PanelIconFileRead,
  readPackageIconFile,
} from '../panel-icon-resolver'

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 9h20" onclick="x()"/></svg>'

let tmpRoot = ''
let packagePath = ''

async function writeText(relativePath: string, value: string) {
  const filePath = path.join(packagePath, relativePath)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, value, 'utf-8')
}

function request(icon: ExtensionPanelIconRequest['icon'], contentHash = 'hash-1') {
  return { packagePath, contentHash, icon } satisfies ExtensionPanelIconRequest
}

function resolveWith(
  resolver: ReturnType<typeof createExtensionPanelIconResolver>,
  input: ExtensionPanelIconRequest,
) {
  return Effect.runPromise(resolver.resolve(input))
}

describe('extension panel icon resolver', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-panel-icon-'))
    packagePath = path.join(tmpRoot, 'package')
    await fs.mkdir(packagePath, { recursive: true })
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('maps kebab-case names to Lucide export names', () => {
    expect(lucideExportName('ticket')).toBe('Ticket')
    expect(lucideExportName('git-pull-request')).toBe('GitPullRequest')
    expect(lucideExportName('arrow-down-0-1')).toBe('ArrowDown01')
  })

  it('resolves a bundled Lucide icon into standalone currentColor SVG', async () => {
    const resolution = await resolveWith(createExtensionPanelIconResolver(), request('ticket'))

    expect(resolution).toEqual({
      status: 'resolved',
      icon: { source: 'lucide', svg: expect.any(String) },
    })
    const svg = resolution.status === 'resolved' ? resolution.icon.svg : ''
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" /u)
    expect(svg).toContain('stroke="currentColor"')
    expect(svg).toContain('viewBox="0 0 24 24"')
    expect(svg).toContain('<path d="M2 9a3 3 0 0 1 0 6v2')
  })

  it('reports an unknown Lucide name as invalid', async () => {
    const resolution = await resolveWith(
      createExtensionPanelIconResolver(),
      request('definitely-not-an-icon'),
    )

    expect(resolution).toEqual({
      status: 'invalid',
      message: '"definitely-not-an-icon" is not a bundled Lucide icon name.',
    })
  })

  it('reads, sanitizes and returns a package SVG icon', async () => {
    await writeText('assets/icon.svg', ICON_SVG)

    const resolution = await resolveWith(
      createExtensionPanelIconResolver(),
      request({ svg: 'assets/icon.svg' }),
    )

    expect(resolution).toEqual({
      status: 'resolved',
      icon: {
        source: 'svg',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 9h20"/></svg>',
      },
    })
  })

  it('rejects SVG icons containing scripts', async () => {
    await writeText(
      'icon.svg',
      '<svg viewBox="0 0 24 24"><script>alert(1)</script><path d="M0 0"/></svg>',
    )

    const resolution = await resolveWith(
      createExtensionPanelIconResolver(),
      request({ svg: 'icon.svg' }),
    )

    expect(resolution).toEqual({
      status: 'invalid',
      message: 'The SVG file contains a <script> element.',
      path: 'icon.svg',
    })
  })

  it('rejects oversized SVG files before reading them', async () => {
    await writeText(
      'icon.svg',
      `<svg viewBox="0 0 1 1"><!--${'x'.repeat(SVG_ICON_MAX_BYTES)}--></svg>`,
    )

    expect(await readPackageIconFile(packagePath, 'icon.svg')).toEqual({
      ok: false,
      message: `The SVG icon is larger than ${String(SVG_ICON_MAX_BYTES)} bytes.`,
      retryable: false,
    })
  })

  it('reports missing SVG files', async () => {
    const resolution = await resolveWith(
      createExtensionPanelIconResolver(),
      request({ svg: 'missing.svg' }),
    )

    expect(resolution).toEqual({
      status: 'invalid',
      message: 'The SVG icon file does not exist.',
      path: 'missing.svg',
    })
  })

  it('refuses SVG icons that resolve outside the package through a symlink', async () => {
    const outsidePath = path.join(tmpRoot, 'outside.svg')
    await fs.writeFile(outsidePath, ICON_SVG, 'utf-8')
    await fs.symlink(outsidePath, path.join(packagePath, 'icon.svg'))

    expect(await readPackageIconFile(packagePath, 'icon.svg')).toEqual({
      ok: false,
      message: 'The SVG icon resolves outside the extension package root.',
      retryable: false,
    })
  })

  it('reads each SVG icon once per installed package content hash', async () => {
    const readIconFile = vi.fn(async () => ({ ok: true as const, source: ICON_SVG }))
    const resolver = createExtensionPanelIconResolver({ readIconFile })

    const first = await resolveWith(resolver, request({ svg: 'icon.svg' }, 'hash-1'))
    const second = await resolveWith(resolver, request({ svg: 'icon.svg' }, 'hash-1'))
    const updated = await resolveWith(resolver, request({ svg: 'icon.svg' }, 'hash-2'))

    expect(second).toEqual(first)
    expect(updated).toEqual(first)
    expect(readIconFile).toHaveBeenCalledTimes(2)
    expect(readIconFile).toHaveBeenNthCalledWith(1, packagePath, 'icon.svg')
  })

  it('resolves the GitHub fixture SVG icon without its title', async () => {
    const fixturePath = path.resolve('fixtures/extensions/openwaggle-github-issues-overview')
    const resolution = await resolveWith(createExtensionPanelIconResolver(), {
      packagePath: fixturePath,
      contentHash: 'fixture',
      icon: { svg: 'assets/resources-icon.svg' },
    })

    expect(resolution.status).toBe('resolved')
    const svg = resolution.status === 'resolved' ? resolution.icon.svg : ''
    expect(svg).toContain('<rect x="4" y="3" width="16" height="18" rx="2"/>')
    expect(svg).not.toContain('<title>')
  })

  it('turns unexpected read failures into an invalid icon', async () => {
    const resolver = createExtensionPanelIconResolver({
      readIconFile: () => Promise.reject(new Error('disk on fire')),
    })

    const resolution = await resolveWith(resolver, request({ svg: 'icon.svg' }))

    expect(resolution).toEqual({
      status: 'invalid',
      message: 'The SVG icon could not be read: disk on fire',
      path: 'icon.svg',
    })
  })

  it('reports a directory at the icon path as not a file', async () => {
    await fs.mkdir(path.join(packagePath, 'icon.svg'))

    expect(await readPackageIconFile(packagePath, 'icon.svg')).toEqual({
      ok: false,
      message: 'The SVG icon is not a file.',
      retryable: false,
    })
  })

  it('reads a package SVG icon within the size limit', async () => {
    await writeText('icon.svg', ICON_SVG)

    expect(await readPackageIconFile(packagePath, 'icon.svg')).toEqual({
      ok: true,
      source: ICON_SVG,
    })
  })

  it('retries a transient read failure instead of caching it', async () => {
    const reads: PanelIconFileRead[] = [
      { ok: false, message: 'The SVG icon could not be read: EMFILE', retryable: true },
      { ok: true, source: ICON_SVG },
    ]
    const readIconFile = vi.fn(async () => reads.shift() ?? { ok: true as const, source: ICON_SVG })
    const resolver = createExtensionPanelIconResolver({ readIconFile })

    const failed = await resolveWith(resolver, request({ svg: 'icon.svg' }))
    const retried = await resolveWith(resolver, request({ svg: 'icon.svg' }))
    const cached = await resolveWith(resolver, request({ svg: 'icon.svg' }))

    expect(failed).toMatchObject({ status: 'invalid', message: expect.stringContaining('EMFILE') })
    expect(retried).toMatchObject({ status: 'resolved' })
    expect(cached).toEqual(retried)
    expect(readIconFile).toHaveBeenCalledTimes(2)
  })

  it('retries after an unexpected rejection instead of caching it', async () => {
    const readIconFile = vi
      .fn<() => Promise<PanelIconFileRead>>()
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValue({ ok: true, source: ICON_SVG })
    const resolver = createExtensionPanelIconResolver({ readIconFile })

    await resolveWith(resolver, request({ svg: 'icon.svg' }))
    const retried = await resolveWith(resolver, request({ svg: 'icon.svg' }))

    expect(retried).toMatchObject({ status: 'resolved' })
    expect(readIconFile).toHaveBeenCalledTimes(2)
  })

  it('caches deterministic failures such as a missing file or an unusable SVG', async () => {
    const readIconFile = vi.fn(
      async (_packagePath: string, relativePath: string): Promise<PanelIconFileRead> =>
        relativePath === 'missing.svg'
          ? { ok: false, message: 'The SVG icon file does not exist.', retryable: false }
          : { ok: true, source: '<svg viewBox="0 0 1 1"><g/></svg>' },
    )
    const resolver = createExtensionPanelIconResolver({ readIconFile })

    for (const svg of ['missing.svg', 'empty.svg', 'missing.svg', 'empty.svg']) {
      expect(await resolveWith(resolver, request({ svg }))).toMatchObject({ status: 'invalid' })
    }
    expect(readIconFile).toHaveBeenCalledTimes(2)
  })

  it('retries a Lucide catalog import that failed', async () => {
    const importCatalog = vi
      .fn<() => Promise<Record<string, never>>>()
      .mockRejectedValueOnce(new Error('import failed'))
      .mockResolvedValue({})
    const loadCatalog = createLucideCatalogLoader(importCatalog)

    await expect(loadCatalog()).rejects.toThrow('import failed')
    await expect(loadCatalog()).resolves.toEqual({})
    await expect(loadCatalog()).resolves.toEqual({})
    expect(importCatalog).toHaveBeenCalledTimes(2)
  })
})
