import { describe, expect, it } from 'vitest'
import {
  assertPackedDocumentationMetadata,
  assertPackedPackageReadme,
} from '../package-smoke-documentation-assertions'

describe('packed package documentation', () => {
  it('requires a self-contained npm landing page', () => {
    const packageName = '@openwaggle/extension-sdk'
    const readme = [
      `# ${packageName}`,
      'npm install @openwaggle/extension-sdk',
      'pnpm add @openwaggle/extension-sdk',
      'yarn add @openwaggle/extension-sdk',
      'bun add @openwaggle/extension-sdk',
      'https://openwaggle.ai/docs/packages/extension-sdk/0.1/',
      'https://github.com/OpenWaggle/OpenWaggle/issues',
      '## License',
    ].join('\n')

    expect(() => assertPackedPackageReadme({ packageName, readme })).not.toThrow()
    expect(() => assertPackedPackageReadme({ packageName, readme: '# incomplete' })).toThrow(
      'README is incomplete',
    )
  })

  it('requires exact versioned documentation and support metadata', () => {
    const manifest = {
      version: '0.1.1',
      homepage: 'https://openwaggle.ai/docs/packages/extension-sdk/0.1/',
      bugs: { url: 'https://github.com/OpenWaggle/OpenWaggle/issues' },
      keywords: ['openwaggle', 'extension', 'sdk', 'typescript'],
    }

    expect(() =>
      assertPackedDocumentationMetadata(manifest, 'packages/extension-sdk'),
    ).not.toThrow()
    expect(() =>
      assertPackedDocumentationMetadata(
        { ...manifest, homepage: 'https://github.com/OpenWaggle/OpenWaggle' },
        'packages/extension-sdk',
      ),
    ).toThrow('incorrect documentation homepage')
  })
})
