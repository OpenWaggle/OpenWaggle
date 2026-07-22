import { describe, expect, it } from 'vitest'

import {
  mergePackedPackageSources,
  parsePackageSmokeArgs,
} from '../package-smoke-canonical'

describe('canonical package smoke inputs', () => {
  it('uses canonical release tarballs by package name without changing their paths', () => {
    const generated = [
      { name: '@openwaggle/extension-sdk', tarballPath: '/tmp/generated-sdk.tgz' },
      { name: '@openwaggle/waggle-core', tarballPath: '/tmp/generated-core.tgz' },
    ]
    const canonical = [
      { name: '@openwaggle/extension-sdk', tarballPath: '/tmp/attested-sdk.tgz' },
    ]

    expect(mergePackedPackageSources(generated, canonical)).toEqual([
      { name: '@openwaggle/extension-sdk', tarballPath: '/tmp/attested-sdk.tgz' },
      { name: '@openwaggle/waggle-core', tarballPath: '/tmp/generated-core.tgz' },
    ])
  })

  it('requires one absolute canonical tarball directory and rejects unknown CLI arguments', () => {
    expect(parsePackageSmokeArgs(['--tarball-dir', '/tmp/release-artifacts'])).toEqual({
      tarballDirectory: '/tmp/release-artifacts',
    })
    expect(() => parsePackageSmokeArgs(['--tarball-dir', 'relative'])).toThrow(
      'Package smoke tarball directory must be absolute.',
    )
    expect(() => parsePackageSmokeArgs(['--unknown'])).toThrow(
      'Usage: package-smoke.ts [--tarball-dir <absolute-directory>].',
    )
  })
})
