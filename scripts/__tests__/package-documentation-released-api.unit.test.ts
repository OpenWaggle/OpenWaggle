import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { generatedApiReferencePackageVersion } from '../package-api-reference-renderer'
import { checkPackageDocumentation } from '../package-documentation'
import { packageDocumentationDefinitions } from '../package-documentation-model'

describe('package API reference pages', () => {
  // Regression: the current line's API page was regenerated from unreleased source, so the 0.2
  // page listed exports the published 0.2.0 package does not have.
  it('keeps a released API page until a release changes the package version', async () => {
    const projectRoot = await lifecycleFs.mkdtemp(
      lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-package-doc-frozen-'),
    )
    const [definition] = packageDocumentationDefinitions.filter(
      (candidate) => candidate.slug === 'extension-sdk',
    )
    if (!definition) throw new Error('Expected the extension SDK documentation definition.')
    const manifestPath = lifecyclePath.join(projectRoot, 'packages/extension-sdk/package.json')
    const snapshotPath = lifecyclePath.join(
      projectRoot,
      'scripts/api-snapshots/extension-sdk.api.md',
    )
    const pagePath = lifecyclePath.join(
      projectRoot,
      'website/src/content/docs/packages/extension-sdk/0.2/api-reference.md',
    )
    const writeManifest = (version: string) =>
      lifecycleFs.writeFile(
        manifestPath,
        JSON.stringify({ version, exports: { '.': { types: './dist/index.d.ts' } } }),
      )
    const writeSnapshot = (name: string) =>
      lifecycleFs.writeFile(
        snapshotPath,
        [
          '### Declarations from `dist/index.d.ts`',
          '',
          '```ts',
          `export declare const ${name}: string;`,
          '```',
        ].join('\n'),
      )
    const apiViolations = async () =>
      (await checkPackageDocumentation(projectRoot, false, [definition])).violations.filter(
        (violation) => violation.includes('api-reference.md'),
      )

    try {
      await Promise.all([
        lifecycleFs.mkdir(lifecyclePath.dirname(manifestPath), { recursive: true }),
        lifecycleFs.mkdir(lifecyclePath.dirname(snapshotPath), { recursive: true }),
        lifecycleFs.mkdir(lifecyclePath.dirname(pagePath), { recursive: true }),
      ])
      await Promise.all([
        writeManifest('0.2.0'),
        writeSnapshot('released'),
        lifecycleFs.writeFile(
          lifecyclePath.join(lifecyclePath.dirname(pagePath), 'index.md'),
          '---\ntitle: Extension SDK\n---\n\nGuide.\n',
        ),
      ])
      await checkPackageDocumentation(projectRoot, true, [definition])
      const released = await lifecycleFs.readFile(pagePath, 'utf8')
      expect(generatedApiReferencePackageVersion(released)).toBe('0.2.0')
      expect(released).toContain('`released`')

      await writeSnapshot('unreleased')
      await expect(apiViolations()).resolves.toEqual([])
      await checkPackageDocumentation(projectRoot, true, [definition])
      await expect(lifecycleFs.readFile(pagePath, 'utf8')).resolves.toBe(released)

      // Regression: a frozen page was never compared with anything, so a hand edit passed.
      await lifecycleFs.writeFile(pagePath, released.replace('`released`', '`edited`'))
      await expect(apiViolations()).resolves.toEqual([
        'website/src/content/docs/packages/extension-sdk/0.2/api-reference.md no longer matches the content hash in its generated marker. A released API page changes only with its package version; restore it from git.',
      ])
      await lifecycleFs.writeFile(pagePath, released)

      await writeManifest('0.2.1')
      await expect(apiViolations()).resolves.toEqual([
        'website/src/content/docs/packages/extension-sdk/0.2/api-reference.md is stale. Run bun run package-docs:update.',
      ])
      await checkPackageDocumentation(projectRoot, true, [definition])
      const next = await lifecycleFs.readFile(pagePath, 'utf8')
      expect(generatedApiReferencePackageVersion(next)).toBe('0.2.1')
      expect(next).toContain('`unreleased`')
    } finally {
      await lifecycleFs.rm(projectRoot, { force: true, recursive: true })
    }
  })
})
