import { describe, expect, it } from 'vitest'
import { collectExactDependencyVersionViolations } from '../standards/exact-dependency-versions'

describe('exact dependency versions', () => {
  const manifest = (sections: Record<string, Record<string, string>>) => JSON.stringify(sections)

  it('accepts exact versions, prereleases, catalogs, and workspace links', () => {
    const contents = manifest({
      dependencies: {
        effect: '3.19.0',
        '@earendil-works/pi-ai': 'catalog:pi-runtime',
        '@openwaggle/waggle-core': 'workspace:^',
      },
      devDependencies: { vite: '9.0.0-beta.3' },
    })

    expect(collectExactDependencyVersionViolations('package.json', contents)).toEqual([])
    expect(
      collectExactDependencyVersionViolations('packages/pi-waggle/package.json', contents),
    ).toEqual([])
  })

  it('reports caret, tilde, and open ranges in every installed section', () => {
    const contents = manifest({
      dependencies: { lexical: '^0.30.0' },
      devDependencies: { vitest: '~4.1.0' },
      optionalDependencies: { 'dmg-license': '*' },
    })

    expect(
      collectExactDependencyVersionViolations('website/package.json', contents).map(
        (violation) => violation.detail,
      ),
    ).toEqual(['lexical: ^0.30.0', 'vitest: ~4.1.0', 'dmg-license: *'])
  })

  it('requires exact versions in the default and named workspace catalogs', () => {
    const rootManifest = JSON.stringify({
      workspaces: {
        packages: ['packages/*'],
        catalog: { zod: '^4.0.0' },
        catalogs: {
          'pi-runtime': { '@earendil-works/pi-ai': '1.4.0', '@earendil-works/pi-tui': '~1.4.0' },
        },
      },
      overrides: { qs: '^6.16.0' },
    })

    expect(
      collectExactDependencyVersionViolations('package.json', rootManifest).map(
        (violation) => violation.detail,
      ),
    ).toEqual(['zod: ^4.0.0', '@earendil-works/pi-tui: ~1.4.0'])
    expect(
      collectExactDependencyVersionViolations('packages/pi-waggle/package.json', rootManifest),
    ).toEqual([])
  })

  it('leaves peer ranges and fixture packages alone', () => {
    expect(
      collectExactDependencyVersionViolations(
        'packages/extension-react/package.json',
        manifest({ peerDependencies: { react: '^19.0.0' } }),
      ),
    ).toEqual([])
    expect(
      collectExactDependencyVersionViolations(
        'fixtures/extensions/openwaggle-reload-qa/package.json',
        manifest({ dependencies: { react: '^19.0.0' } }),
      ),
    ).toEqual([])
  })
})
