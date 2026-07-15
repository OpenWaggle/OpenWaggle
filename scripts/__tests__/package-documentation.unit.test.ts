import { describe, expect, it } from 'vitest'
import {
  packageInstallMarkdown,
  renderPackageReadme,
  rewritePackageDocumentationLinks,
} from '../package-documentation-renderer'
import { withPackageDocumentationMetadata } from '../package-documentation-manifest'
import { packageDocumentation } from '../package-documentation-model'
import { requiredAuthoredPackageDocumentationFiles } from '../package-documentation'

describe('package documentation rendering', () => {
  it('synchronizes package metadata from the canonical package registry', () => {
    const definition = packageDocumentation[0]
    const manifest = withPackageDocumentationMetadata(
      { version: '0.1.0', exports: { '.': './dist/index.js' }, privateField: true },
      definition,
      'https://openwaggle.ai/docs/packages/extension-sdk/0.1/',
    )

    expect(manifest).toMatchObject({
      name: '@openwaggle/extension-sdk',
      description: definition.description,
      homepage: 'https://openwaggle.ai/docs/packages/extension-sdk/0.1/',
      keywords: definition.keywords,
      privateField: true,
    })
  })

  it('requires every historical guide and API page declared by the version selector', () => {
    const definition = {
      ...packageDocumentation[0],
      versions: ['0.1', '0.2'],
      currentVersion: '0.2',
    } as const

    expect(requiredAuthoredPackageDocumentationFiles('/repo', definition)).toEqual([
      '/repo/website/src/content/docs/packages/extension-sdk/0.1/index.md',
      '/repo/website/src/content/docs/packages/extension-sdk/0.1/api-reference.md',
      '/repo/website/src/content/docs/packages/extension-sdk/0.2/index.md',
    ])
  })

  it('renders tested install commands for every supported package manager', () => {
    expect(packageInstallMarkdown('@openwaggle/example peer-package')).toBe(
      [
        '## Install',
        '',
        '### npm',
        '',
        '```bash',
        'npm install @openwaggle/example peer-package',
        '```',
        '',
        '### pnpm',
        '',
        '```bash',
        'pnpm add @openwaggle/example peer-package',
        '```',
        '',
        '### Yarn',
        '',
        '```bash',
        'yarn add @openwaggle/example peer-package',
        '```',
        '',
        '### Bun',
        '',
        '```bash',
        'bun add @openwaggle/example peer-package',
        '```',
      ].join('\n'),
    )
  })

  it('rewrites website-relative links to absolute public documentation links', () => {
    expect(
      rewritePackageDocumentationLinks(
        '[Extensions](/docs/extending/openwaggle-extensions) and [API](./api-reference).',
        'https://openwaggle.ai/docs/packages/example/0.1/',
      ),
    ).toBe(
      '[Extensions](https://openwaggle.ai/docs/extending/openwaggle-extensions/) and [API](https://openwaggle.ai/docs/packages/example/0.1/api-reference/).',
    )
  })

  it('generates a self-contained npm landing page from canonical website documentation', () => {
    const readme = renderPackageReadme({
      canonicalBody: [
        '`@openwaggle/example` provides an example.',
        '',
        '<package-install packages="@openwaggle/example"></package-install>',
        '',
        'See the [API](./api-reference).',
      ].join('\n'),
      description: 'Typed example package.',
      docsUrl: 'https://openwaggle.ai/docs/packages/example/0.1/',
      packageName: '@openwaggle/example',
    })

    expect(readme).toContain('<!-- Generated from the canonical OpenWaggle package documentation. -->')
    expect(readme).toContain('# @openwaggle/example')
    expect(readme).toContain('[Full documentation](https://openwaggle.ai/docs/packages/example/0.1/)')
    expect(readme).toContain('npm install @openwaggle/example')
    expect(readme).toContain(
      '[API](https://openwaggle.ai/docs/packages/example/0.1/api-reference/)',
    )
    expect(readme).not.toContain('<package-install')
  })
})
