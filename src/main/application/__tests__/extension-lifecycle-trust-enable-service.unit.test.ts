import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import {
  acceptExtensionUpdate,
  setExtensionEnabled,
  setExtensionTrusted,
} from '../extension-lifecycle-service'

const PROJECT_PATH = '/tmp/project'

const discoveredPackage: DiscoveredExtensionPackage = {
  id: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  manifest: {
    manifestVersion: 1,
    id: 'sample-extension',
    name: 'Sample Extension',
    version: '1.0.0',
    sdk: { openwaggle: '>=0.1.0 <0.2.0' },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: ['dist/index.js'],
    capabilities: [{ id: 'sample.invoke' }],
  },
  contentHash: 'abcdef',
  sdkCompatibility: {
    hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  diagnostics: [],
}

const lifecycleState: ExtensionLifecycleState = {
  extensionId: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  enabled: true,
  trusted: true,
  grantedCapabilities: ['sample.invoke'],
  contentHash: 'abcdef',
  packageVersion: '1.0.0',
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

function makeTestHarness({
  packages,
  lifecycle,
}: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycle: ExtensionLifecycleState | null
}) {
  let storedLifecycle = lifecycle
  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed(packages),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.sync(() => storedLifecycle),
        list: () => Effect.succeed(storedLifecycle ? [storedLifecycle] : []),
        upsert: (state) =>
          Effect.sync(() => {
            storedLifecycle = state
          }),
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
    ),
    getStoredLifecycle: () => storedLifecycle,
  }
}

describe('extension trust and enable lifecycle mutations', () => {
  it('trusts a valid extension by pinning the current content hash', async () => {
    const harness = makeTestHarness({ packages: [discoveredPackage], lifecycle: null })

    const view = await Effect.runPromise(
      setExtensionTrusted({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        trusted: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: 'sample-extension',
      enabled: false,
      trusted: true,
      grantedCapabilities: ['sample.invoke'],
      contentHash: 'abcdef',
      packageVersion: '1.0.0',
      sdkCompatible: true,
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({ enabled: false, trusted: true })
  })

  it('rejects generic trust repinning when a trusted package changed', async () => {
    const updatedPackage = { ...discoveredPackage, contentHash: 'changed-hash' }
    const harness = makeTestHarness({ packages: [updatedPackage], lifecycle: lifecycleState })

    await expect(
      Effect.runPromise(
        setExtensionTrusted({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
          trusted: true,
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(OPENWAGGLE_EXTENSION.LIFECYCLE.APPROVE_UPDATE_REQUIRED_ERROR)

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: 'sample-extension',
      enabled: true,
      trusted: true,
      contentHash: 'abcdef',
      packageVersion: '1.0.0',
    })
  })

  it('accepts an updated trusted package by repinning hash and disabling runtime loading', async () => {
    const updatedPackage: DiscoveredExtensionPackage = {
      ...discoveredPackage,
      manifest: discoveredPackage.manifest
        ? { ...discoveredPackage.manifest, version: '1.1.0' }
        : null,
      contentHash: 'changed-hash',
    }
    const harness = makeTestHarness({ packages: [updatedPackage], lifecycle: lifecycleState })

    const view = await Effect.runPromise(
      acceptExtensionUpdate({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: 'sample-extension',
      enabled: false,
      trusted: true,
      contentHash: 'changed-hash',
      packageVersion: '1.1.0',
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: true,
      contentHash: 'changed-hash',
      packageVersion: '1.1.0',
      updateAvailable: false,
    })
  })

  it('rejects update approval when the package has not changed', async () => {
    const harness = makeTestHarness({ packages: [discoveredPackage], lifecycle: lifecycleState })

    await expect(
      Effect.runPromise(
        acceptExtensionUpdate({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow(OPENWAGGLE_EXTENSION.LIFECYCLE.NO_UPDATE_AVAILABLE_ERROR)
  })

  it('rejects enabling an extension before it has a current trust pin', async () => {
    const harness = makeTestHarness({ packages: [discoveredPackage], lifecycle: null })

    await expect(
      Effect.runPromise(
        setExtensionEnabled({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
          enabled: true,
        }).pipe(Effect.provide(harness.layer)),
      ),
    ).rejects.toThrow('Trust extension "sample-extension" before enabling it.')
  })

  it('enables a trusted extension when the trust pin matches the current content hash', async () => {
    const harness = makeTestHarness({ packages: [discoveredPackage], lifecycle: lifecycleState })

    const view = await Effect.runPromise(
      setExtensionEnabled({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        enabled: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      extensionId: 'sample-extension',
      enabled: true,
      trusted: true,
      contentHash: 'abcdef',
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({ enabled: true, trusted: true })
  })
})
