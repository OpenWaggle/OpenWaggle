import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import {
  loadRegistry,
  makeLifecycle,
  makePackage,
  PROJECT_PATH,
} from './extension-contribution-registry-test-utils'

function packageWithBadManifest(): DiscoveredExtensionPackage {
  const packagePath = '/tmp/user-data/extensions/bad-manifest-extension'
  const manifestPath = `${packagePath}/${OPENWAGGLE_EXTENSION.MANIFEST_FILE}`

  return {
    id: 'bad-manifest-extension',
    scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
    packagePath,
    manifestPath,
    manifest: null,
    buildPlan: null,
    contentHash: null,
    sdkCompatibility: null,
    diagnostics: [
      {
        severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.MANIFEST_JSON_INVALID,
        message: 'Invalid manifest JSON.',
        path: manifestPath,
      },
    ],
  }
}

describe('listExtensionContributionRegistryView startup isolation', () => {
  it('keeps healthy package contributions when another package has a bad manifest', async () => {
    const healthyPackage = makePackage({
      id: 'healthy-extension',
      name: 'Healthy Extension',
      scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
      contributions: {
        commands: [{ id: 'healthy.run', title: 'Run Healthy' }],
      },
    })

    const registry = await loadRegistry({
      packages: [packageWithBadManifest(), healthyPackage],
      lifecycles: [makeLifecycle(healthyPackage)],
      projectPaths: [PROJECT_PATH],
    })

    expect(registry.entries.map((entry) => entry.contributionId)).toEqual(['healthy.run'])
    expect(registry.diagnostics).toEqual([
      expect.objectContaining({
        severity: OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY.ERROR,
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.MANIFEST_JSON_INVALID,
      }),
    ])
  })
})
