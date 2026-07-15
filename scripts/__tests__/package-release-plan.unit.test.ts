import { describe, expect, it } from 'vitest'

import { decodePackageReleasePlan, resolvePackageReleasePlan } from '../package-release-plan'

describe('package release plan', () => {
  it('rejects a base-only release after resolving every package version', async () => {
    const reads: string[] = []

    await expect(
      resolvePackageReleasePlan(
        { beforeSha: 'before', sourceSha: 'source', sourceTree: 'tree' },
        async (revision, packagePath) => {
          reads.push(`${revision}:${packagePath}`)
          if (packagePath === 'packages/extension-sdk' && revision === 'source') return '0.1.1'
          return '0.1.0'
        },
      ),
    ).rejects.toThrow('@openwaggle/extension-sdk requires a coordinated @openwaggle/extension-react release')

    expect(reads).toHaveLength(8)
  })

  it('requires pi-waggle when waggle-core releases', async () => {
    await expect(
      resolvePackageReleasePlan(
        { beforeSha: 'before', sourceSha: 'source', sourceTree: 'tree' },
        async (revision, packagePath) =>
          packagePath === 'packages/waggle-core' && revision === 'source' ? '0.1.1' : '0.1.0',
      ),
    ).rejects.toThrow('@openwaggle/waggle-core requires a coordinated @openwaggle/pi-waggle release')
  })

  it('rejects a decoded base-only plan', () => {
    expect(() => decodePackageReleasePlan({
      packages: [{
        key: 'extension-sdk',
        name: '@openwaggle/extension-sdk',
        packagePath: 'packages/extension-sdk',
        tag: 'extension-sdk-v0.1.1',
        version: '0.1.1',
      }],
      schemaVersion: 1,
      sourceSha: 'source',
      sourceTree: 'tree',
    })).toThrow('@openwaggle/extension-sdk requires a coordinated @openwaggle/extension-react release')
  })

  it('selects only packages whose stable version increased and preserves dependency order', async () => {
    const versions = new Map([
      ['before:packages/extension-sdk/package.json', '0.1.0'],
      ['source:packages/extension-sdk/package.json', '0.1.1'],
      ['before:packages/extension-react/package.json', '0.1.0'],
      ['source:packages/extension-react/package.json', '0.1.1'],
      ['before:packages/waggle-core/package.json', '0.1.0'],
      ['source:packages/waggle-core/package.json', '0.1.0'],
      ['before:packages/pi-waggle/package.json', '0.1.0'],
      ['source:packages/pi-waggle/package.json', '0.1.0'],
    ])

    const plan = await resolvePackageReleasePlan(
      { beforeSha: 'before', sourceSha: 'source', sourceTree: 'tree' },
      async (revision, packagePath) => {
        const version = versions.get(`${revision}:${packagePath}/package.json`)
        if (version === undefined) throw new Error('Missing test package version.')
        return version
      },
    )

    expect(plan).toEqual({
      schemaVersion: 1,
      sourceSha: 'source',
      sourceTree: 'tree',
      packages: [
        {
          key: 'extension-sdk',
          name: '@openwaggle/extension-sdk',
          packagePath: 'packages/extension-sdk',
          tag: 'extension-sdk-v0.1.1',
          version: '0.1.1',
        },
        {
          dependency: '@openwaggle/extension-sdk',
          key: 'extension-react',
          name: '@openwaggle/extension-react',
          packagePath: 'packages/extension-react',
          tag: 'extension-react-v0.1.1',
          version: '0.1.1',
        },
      ],
    })
  })

  it('rejects version decreases and prerelease versions', async () => {
    await expect(
      resolvePackageReleasePlan(
        { beforeSha: 'before', sourceSha: 'source', sourceTree: 'tree' },
        async (revision) => (revision === 'before' ? '0.2.0' : '0.1.0'),
      ),
    ).rejects.toThrow('must increase')

    await expect(
      resolvePackageReleasePlan(
        { beforeSha: 'before', sourceSha: 'source', sourceTree: 'tree' },
        async (revision) => (revision === 'before' ? '0.1.0' : '0.2.0-beta.1'),
      ),
    ).rejects.toThrow('stable semantic version')
  })
})
