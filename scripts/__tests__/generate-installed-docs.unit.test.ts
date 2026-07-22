import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { safeDecodeUnknown } from '@shared/schema'
import { installedDocsManifestSchema } from '@shared/schemas/docs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  generateInstalledDocs,
  rewriteInstalledDocumentationLinks,
} from '../installed-docs-generator'

let tempDir = ''

function outputRoot() {
  return lifecyclePath.join(tempDir, 'openwaggle-docs')
}

beforeEach(async () => {
  tempDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-installed-docs-'),
  )
  await generateInstalledDocs({
    outputRoot: outputRoot(),
    generatedAt: '2026-06-05T00:00:00.000Z',
  })
})

afterEach(async () => {
  await lifecycleFs.rm(tempDir, { recursive: true, force: true })
})

describe('installed docs generator output', () => {
  it('preserves query and hash fragments when rewriting the documentation root', () => {
    expect(
      rewriteInstalledDocumentationLinks(
        '[Docs](/docs?view=all#top)',
        '/docs/packages/overview',
        'topics/openwaggle/packages/overview.md',
        new Map([['/docs', 'README.md']]),
      ),
    ).toBe('[Docs](../../../README.md?view=all#top)')
  })

  it('generates first-party OpenWaggle and Pi topic ids from installed docs sources', async () => {
    const rawManifest = await lifecycleFs.readFile(
      lifecyclePath.join(outputRoot(), 'index.json'),
      'utf8',
    )
    const parsed: unknown = JSON.parse(rawManifest)
    const decoded = safeDecodeUnknown(installedDocsManifestSchema, parsed)
    if (!decoded.success) {
      throw new Error(decoded.issues.join('; '))
    }
    const topicIds = decoded.data.topics.map((topic) => topic.topic)

    expect(topicIds).toContain('openwaggle:extending/openwaggle-extensions')
    expect(topicIds).toContain('pi:extensions')
    expect(topicIds.some((topic) => topic.startsWith('extension:'))).toBe(false)
  })

  it('keeps the generated bundle sourced from website docs and installed Pi docs only', async () => {
    const [readme, rawManifest] = await Promise.all([
      lifecycleFs.readFile(lifecyclePath.join(outputRoot(), 'README.md'), 'utf8'),
      lifecycleFs.readFile(lifecyclePath.join(outputRoot(), 'index.json'), 'utf8'),
    ])
    const parsed: unknown = JSON.parse(rawManifest)
    const decoded = safeDecodeUnknown(installedDocsManifestSchema, parsed)
    if (!decoded.success) {
      throw new Error(decoded.issues.join('; '))
    }

    expect(readme).toContain(
      'generated from `website/src/content/docs/**` and installed Pi package docs',
    )
    expect(readme).not.toContain('fixtures/extensions')
    expect(decoded.data.topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          topic: 'openwaggle:extending/openwaggle-extensions',
          sourcePath: 'website/src/content/docs/extending/openwaggle-extensions.md',
        }),
        expect.objectContaining({
          topic: 'pi:extensions',
          sourcePath: 'node_modules/@earendil-works/pi-coding-agent/docs/extensions.md',
        }),
      ]),
    )
    expect(decoded.data.topics.every((topic) => !topic.topic.startsWith('extension:'))).toBe(true)
    expect(
      decoded.data.topics.every(
        (topic) =>
          topic.sourcePath.startsWith('website/src/content/docs/') ||
          topic.sourcePath.startsWith('node_modules/@earendil-works/pi-coding-agent/docs/'),
      ),
    ).toBe(true)
  })

  it('expands website-only package install elements for agent-readable Markdown', async () => {
    const packageGuide = await lifecycleFs.readFile(
      lifecyclePath.join(
        outputRoot(),
        'topics',
        'openwaggle',
        'packages',
        'extension-sdk',
        '0.1',
        'index.md',
      ),
      'utf8',
    )

    expect(packageGuide).toContain('npm install @openwaggle/extension-sdk')
    expect(packageGuide).toContain('pnpm add @openwaggle/extension-sdk')
    expect(packageGuide).not.toContain('<package-install')
  })

  it('rewrites website-root links to resolvable relative installed-doc paths', async () => {
    const packageOverviewPath = lifecyclePath.join(
      outputRoot(),
      'topics',
      'openwaggle',
      'packages',
      'overview.md',
    )
    const packageOverview = await lifecycleFs.readFile(packageOverviewPath, 'utf8')

    expect(packageOverview).toContain(
      '[`@openwaggle/extension-sdk`](./extension-sdk/0.1/index.md)',
    )
    expect(packageOverview).toContain(
      '[OpenWaggle Extensions](../extending/openwaggle-extensions.md)',
    )
    expect(packageOverview).not.toMatch(/\]\(\/docs(?:\/|\))/u)

    await expect(
      lifecycleFs.stat(
        lifecyclePath.resolve(
          lifecyclePath.dirname(packageOverviewPath),
          './extension-sdk/0.1/index.md',
        ),
      ),
    ).resolves.toBeDefined()
  })

  it('resolves every local Markdown link in the installed OpenWaggle bundle', async () => {
    const rawManifest = await lifecycleFs.readFile(
      lifecyclePath.join(outputRoot(), 'index.json'),
      'utf8',
    )
    const parsed: unknown = JSON.parse(rawManifest)
    const decoded = safeDecodeUnknown(installedDocsManifestSchema, parsed)
    if (!decoded.success) throw new Error(decoded.issues.join('; '))

    for (const topic of decoded.data.topics.filter(({ source }) => source === 'openwaggle')) {
      const topicPath = lifecyclePath.join(outputRoot(), topic.bundlePath)
      const contents = await lifecycleFs.readFile(topicPath, 'utf8')
      const destinations = [...contents.matchAll(/(?<!!)\[[^\]]+\]\(([^)\s]+)\)/gu)]
        .map((match) => match[1])
        .filter((destination) => destination !== undefined)

      for (const destination of destinations) {
        if (
          destination.startsWith('#') ||
          /^[a-z][a-z\d+.-]*:/iu.test(destination)
        ) {
          continue
        }
        expect(
          destination.startsWith('/'),
          `${topic.topic} retains a website-root link`,
        ).toBe(false)
        const localPath = destination.split(/[?#]/u, 1)[0]
        if (!localPath) continue
        await expect(
          lifecycleFs.stat(lifecyclePath.resolve(lifecyclePath.dirname(topicPath), localPath)),
          `${topic.topic} cannot resolve ${destination}`,
        ).resolves.toBeDefined()
      }
    }
  })
})
