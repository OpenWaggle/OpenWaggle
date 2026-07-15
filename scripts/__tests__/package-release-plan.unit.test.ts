import { describe, expect, it } from 'vitest'

import { resolvePackageReleasePlan } from '../package-release-plan'

describe('package release plan', () => {
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
