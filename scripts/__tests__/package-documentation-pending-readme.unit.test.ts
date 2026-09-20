import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkPackageDocumentation } from '../package-documentation'
import { withPackageDocumentationMetadata } from '../package-documentation-manifest'
import {
  packageDocumentationDefinitions,
  versionPackageDocumentation,
} from '../package-documentation-model'

describe('pending package documentation guards', () => {
  it('rejects published README drift while a future documentation line is pending', async () => {
    const projectRoot = await lifecycleFs.mkdtemp(
      lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-package-doc-readme-drift-'),
    )
    const baseDefinition = packageDocumentationDefinitions[0]
    const definition = versionPackageDocumentation(baseDefinition, ['0.1'])
    const docsUrl = 'https://openwaggle.ai/docs/packages/extension-sdk/0.1/'
    const publishedRoot = lifecyclePath.join(
      projectRoot,
      'website/src/content/docs/packages/extension-sdk/0.1',
    )
    const pendingRoot = lifecyclePath.join(
      projectRoot,
      'website/src/content/package-docs-next/extension-sdk',
    )
    const packageRoot = lifecyclePath.join(projectRoot, 'packages/extension-sdk')

    try {
      await Promise.all([
        lifecycleFs.mkdir(publishedRoot, { recursive: true }),
        lifecycleFs.mkdir(pendingRoot, { recursive: true }),
        lifecycleFs.mkdir(packageRoot, { recursive: true }),
      ])
      const manifest = withPackageDocumentationMetadata(
        {
          version: '0.1.1',
          exports: { '.': { types: './dist/index.d.ts' } },
        },
        definition,
        docsUrl,
      )
      await Promise.all([
        lifecycleFs.writeFile(
          lifecyclePath.join(publishedRoot, 'index.md'),
          ['---', 'title: "Extension SDK"', '---', '', 'Published guide.'].join('\n'),
        ),
        lifecycleFs.writeFile(
          lifecyclePath.join(publishedRoot, 'api-reference.md'),
          'Published API.\n',
        ),
        lifecycleFs.writeFile(
          lifecyclePath.join(pendingRoot, 'index.md'),
          'Future 0.2 guide.\n',
        ),
        lifecycleFs.writeFile(
          lifecyclePath.join(packageRoot, 'package.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
        ),
        lifecycleFs.writeFile(
          lifecyclePath.join(packageRoot, 'README.md'),
          'Unreleased resource API accidentally copied into the published README.\n',
        ),
      ])

      const result = await checkPackageDocumentation(projectRoot, false, [baseDefinition])

      expect(result.violations).toContain(
        'packages/extension-sdk/README.md is stale. Run pnpm package-docs:update.',
      )
      expect(result.violations).not.toContain(
        'website/src/content/docs/packages/extension-sdk/0.1/api-reference.md is stale. Run pnpm package-docs:update.',
      )
    } finally {
      await lifecycleFs.rm(projectRoot, { force: true, recursive: true })
    }
  })
})
