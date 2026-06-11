import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import {
  clearCachedPackageContributionRegistrations,
  clearExtensionContributionRegistryCacheForTests,
  getCachedPackageContributionRegistrations,
  getExtensionContributionRegistryCacheStatsForTests,
  pruneCachedPackageContributionRegistrations,
} from '../extension-contribution-registry-cache'
import { makePackage } from './extension-contribution-registry-test-utils'

function packageWithBrokenCacheKey(): DiscoveredExtensionPackage {
  return fromPartial<DiscoveredExtensionPackage>(
    Object.defineProperty(
      {
        id: 'broken-cache-key-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
        manifestPath: '/tmp/broken-cache-key/openwaggle.extension.json',
      },
      'packagePath',
      {
        get() {
          throw new Error('package path unavailable')
        },
      },
    ),
  )
}

describe('extension contribution registry cache isolation', () => {
  beforeEach(() => {
    clearExtensionContributionRegistryCacheForTests()
  })

  it('keeps cache maintenance best-effort when package cache keys cannot be derived', () => {
    const extensionPackage = makePackage({
      id: 'safe-cache-extension',
      name: 'Safe Cache Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'safe-cache.run', title: 'Run Safe Cache' }],
      },
    })

    getCachedPackageContributionRegistrations(extensionPackage)

    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({ size: 1 })
    expect(() =>
      clearCachedPackageContributionRegistrations(packageWithBrokenCacheKey()),
    ).not.toThrow()
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      invalidations: 1,
      size: 0,
    })

    getCachedPackageContributionRegistrations(extensionPackage)

    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({ size: 1 })
    expect(() =>
      pruneCachedPackageContributionRegistrations([packageWithBrokenCacheKey()]),
    ).not.toThrow()
    expect(getExtensionContributionRegistryCacheStatsForTests()).toMatchObject({
      invalidations: 2,
      size: 0,
    })
  })
})
