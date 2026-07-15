import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  packageInstallMarkdown,
  renderPackageReadme,
  rewritePackageDocumentationLinks,
} from '../package-documentation-renderer'
import { withPackageDocumentationMetadata } from '../package-documentation-manifest'
import {
  documentationVersionFromPackageVersion,
  packageDocumentationDefinitions,
  resolvePackageDocumentationVersions,
  versionPackageDocumentation,
} from '../package-documentation-model'
import {
  preparePackageDocumentationLine,
  requiredAuthoredPackageDocumentationFiles,
} from '../package-documentation'
import { renderApiReference } from '../package-api-reference-renderer'

const packageDocumentation = packageDocumentationDefinitions.map((definition) =>
  versionPackageDocumentation(definition, ['0.1']),
)

describe('package documentation rendering', () => {
  it('opens a new major.minor line while preserving earlier documentation versions', () => {
    expect(documentationVersionFromPackageVersion('0.1.9')).toBe('0.1')
    expect(documentationVersionFromPackageVersion('0.2.0')).toBe('0.2')
    expect(resolvePackageDocumentationVersions(['0.1'], '0.2.0')).toEqual({
      currentVersion: '0.2',
      versions: ['0.1', '0.2'],
    })
  })

  it('promotes pending authored pages without changing published history', async () => {
    const projectRoot = await lifecycleFs.mkdtemp(
      lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-package-doc-line-'),
    )
    const definition = packageDocumentation[1]
    const historicalRoot = lifecyclePath.join(
      projectRoot,
      'website/src/content/docs/packages/extension-react/0.1',
    )
    const historicalFiles = {
      'api-reference.md': 'historical generated API\n',
      'components.md': 'historical component catalogue\n',
      'index.md': 'historical guide\n',
    }
    const pendingRoot = lifecyclePath.join(
      projectRoot,
      'website/src/content/package-docs-next/extension-react',
    )
    const pendingFiles = {
      'components.md': 'future component catalogue\n',
      'index.md': 'future guide\n',
    }

    try {
      await Promise.all([
        lifecycleFs.mkdir(historicalRoot, { recursive: true }),
        lifecycleFs.mkdir(pendingRoot, { recursive: true }),
      ])
      await Promise.all(
        [
          ...Object.entries(historicalFiles).map(([fileName, contents]) =>
            lifecycleFs.writeFile(lifecyclePath.join(historicalRoot, fileName), contents),
          ),
          ...Object.entries(pendingFiles).map(([fileName, contents]) =>
            lifecycleFs.writeFile(lifecyclePath.join(pendingRoot, fileName), contents),
          ),
        ],
      )

      const result = await preparePackageDocumentationLine(
        projectRoot,
        definition,
        '0.2.0',
      )

      expect(result).toEqual({
        createdFiles: [
          'website/src/content/docs/packages/extension-react/0.2/index.md',
          'website/src/content/docs/packages/extension-react/0.2/components.md',
        ],
        currentVersion: '0.2',
        versions: ['0.1', '0.2'],
      })
      await expect(
        lifecycleFs.readFile(
          lifecyclePath.join(projectRoot, 'website/src/content/docs/packages/extension-react/0.2/index.md'),
          'utf8',
        ),
      ).resolves.toBe(pendingFiles['index.md'])
      await expect(
        lifecycleFs.readFile(
          lifecyclePath.join(
            projectRoot,
            'website/src/content/docs/packages/extension-react/0.2/components.md',
          ),
          'utf8',
        ),
      ).resolves.toBe(pendingFiles['components.md'])
      await expect(
        lifecycleFs.readFile(
          lifecyclePath.join(
            projectRoot,
            'website/src/content/docs/packages/extension-react/0.2/api-reference.md',
          ),
          'utf8',
        ),
      ).rejects.toMatchObject({ code: 'ENOENT' })
      await Promise.all(
        Object.entries(historicalFiles).map(async ([fileName, contents]) => {
          await expect(
            lifecycleFs.readFile(lifecyclePath.join(historicalRoot, fileName), 'utf8'),
          ).resolves.toBe(contents)
        }),
      )
      await expect(lifecycleFs.stat(pendingRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await lifecycleFs.rm(projectRoot, { force: true, recursive: true })
    }
  })

  it('rejects a new documentation line without a complete pending source', async () => {
    const projectRoot = await lifecycleFs.mkdtemp(
      lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-package-doc-pending-'),
    )
    const definition = packageDocumentation[1]
    try {
      await lifecycleFs.mkdir(
        lifecyclePath.join(projectRoot, 'website/src/content/docs/packages/extension-react/0.1'),
        { recursive: true },
      )
      await expect(
        preparePackageDocumentationLine(projectRoot, definition, '0.2.0'),
      ).rejects.toThrow('requires authored pending documentation')
    } finally {
      await lifecycleFs.rm(projectRoot, { force: true, recursive: true })
    }
  })

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

  it('inventories mixed direct, named, default, and recursive star exports', () => {
    const snapshot = [
      '### Declarations from `dist/index.d.ts`',
      '',
      '```ts',
      "export * from './star.js';",
      "export type * from './types.js';",
      "export { renamed as alias, type Named } from './named.js';",
      'export declare const direct: string;',
      'export default function defaultEntry(): void;',
      '```',
      '',
      '### Declarations from `dist/star.d.ts`',
      '',
      '```ts',
      "export * from './nested.js';",
      'export declare function starred(): void;',
      '```',
      '',
      '### Declarations from `dist/nested.d.ts`',
      '',
      '```ts',
      "export * from './index.js';",
      'export interface Nested {}',
      '```',
      '',
      '### Declarations from `dist/types.d.ts`',
      '',
      '```ts',
      'export type StarredType = string;',
      '```',
      '',
      '### Declarations from `dist/named.d.ts`',
      '',
      '```ts',
      'export declare function renamed(): void;',
      'export interface Named {}',
      '```',
    ].join('\n')

    const reference = renderApiReference({
      apiDescription: 'Synthetic public API.',
      exports: { '.': { types: './dist/index.d.ts' } },
      packageName: '@openwaggle/example',
      snapshot,
      version: '0.2',
    })

    expect(reference).toContain('| `direct` | const |')
    expect(reference).toContain('| `starred` | function |')
    expect(reference).toContain('| `Nested` | interface |')
    expect(reference).toContain('| `StarredType` | type |')
    expect(reference).toContain('| `alias` | function |')
    expect(reference).toContain('| `Named` | interface |')
    expect(reference).toContain('| `default` | default export |')
    expect(reference).not.toContain('This export contains styles or re-exports')
  })
})
