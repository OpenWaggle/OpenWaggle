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
  registerRuntimePackageContribution,
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

  it('does not drop runtime registrations during query-local static cache pruning', () => {
    const runtimePackage = makePackage({
      id: 'runtime-cache-extension',
      name: 'Runtime Cache Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: '/tmp/project-a' },
      contributions: {
        toolRenderers: [],
      },
    })
    const unrelatedPackage = makePackage({
      id: 'unrelated-cache-extension',
      name: 'Unrelated Cache Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: '/tmp/project-b' },
      contributions: {
        commands: [{ id: 'unrelated.run', title: 'Run Unrelated' }],
      },
    })
    registerRuntimePackageContribution({
      extensionPackage: runtimePackage,
      registration: {
        family: OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.TOOL_RENDERERS,
        contribution: {
          id: 'runtime.tool',
          title: 'Runtime Tool',
          runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
          execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.HOST_RENDERER,
          entry: 'dist/runtime-tool.js',
          target: { projectPaths: ['/tmp/project-a'] },
        },
      },
    })

    pruneCachedPackageContributionRegistrations([unrelatedPackage])

    expect(
      getCachedPackageContributionRegistrations(runtimePackage).registrations.map(
        (registration) => registration.contribution.id,
      ),
    ).toEqual(['runtime.tool'])
  })
})
