import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleState,
  ExtensionProjectOverrideState,
} from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { setExtensionProjectDisabled } from '../extension-lifecycle-service'
import { listExtensionPackagesView } from '../extension-manager-view-service'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from '../extension-runtime-service'

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

const globalPackage: DiscoveredExtensionPackage = {
  ...discoveredPackage,
  id: 'global-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  packagePath: '/tmp/user-data/extensions/global-extension',
  manifestPath: '/tmp/user-data/extensions/global-extension/openwaggle.extension.json',
  manifest: discoveredPackage.manifest
    ? { ...discoveredPackage.manifest, id: 'global-extension', name: 'Global Extension' }
    : null,
}

const lifecycleState: ExtensionLifecycleState = {
  extensionId: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  enabled: true,
  trusted: true,
  grantedCapabilities: ['sample.invoke'],
  contentHash: 'abcdef',
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

const globalLifecycleState: ExtensionLifecycleState = {
  ...lifecycleState,
  extensionId: 'global-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
}

function makeTestHarness({
  packages,
  lifecycle,
  projectOverride = null,
}: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverride?: ExtensionProjectOverrideState | null
}) {
  let storedProjectOverride = projectOverride
  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed(packages),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.succeed(lifecycle),
        list: () => Effect.succeed(lifecycle ? [lifecycle] : []),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.sync(() => storedProjectOverride),
        upsert: (state) =>
          Effect.sync(() => {
            storedProjectOverride = state
          }),
      }),
    ),
    getStoredProjectOverride: () => storedProjectOverride,
  }
}

describe('extension project overrides', () => {
  it('applies project opt-out as an effective disable without clearing the trust pin', async () => {
    const harness = makeTestHarness({
      packages: [discoveredPackage],
      lifecycle: lifecycleState,
      projectOverride: {
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        projectPath: PROJECT_PATH,
        disabled: true,
        createdAt: 3000,
        updatedAt: 4000,
      },
    })

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(view.packages[0]?.lifecycle).toMatchObject({
      enabled: false,
      trusted: true,
      grantedCapabilities: [],
      contentHash: 'abcdef',
    })
    expect(view.packages[0]?.projectOverride).toEqual({
      projectPath: PROJECT_PATH,
      disabled: true,
      updatedAt: 4000,
    })
  })

  it('excludes project-disabled packages from the Pi runtime allowlist', async () => {
    const harness = makeTestHarness({
      packages: [discoveredPackage],
      lifecycle: lifecycleState,
      projectOverride: {
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        projectPath: PROJECT_PATH,
        disabled: true,
        createdAt: 3000,
        updatedAt: 4000,
      },
    })

    const enabledPackagePaths = await Effect.runPromise(
      listRuntimeEnabledOpenWaggleExtensionPackagePaths(PROJECT_PATH).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(enabledPackagePaths).toEqual([])
  })

  it('includes trusted and enabled project packages in the Pi runtime allowlist', async () => {
    const harness = makeTestHarness({
      packages: [discoveredPackage],
      lifecycle: lifecycleState,
    })

    const enabledPackagePaths = await Effect.runPromise(
      listRuntimeEnabledOpenWaggleExtensionPackagePaths(PROJECT_PATH).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(enabledPackagePaths).toEqual([discoveredPackage.packagePath])
  })

  it('includes trusted global packages in the Pi runtime allowlist for a project', async () => {
    const harness = makeTestHarness({
      packages: [globalPackage],
      lifecycle: globalLifecycleState,
    })

    const enabledPackagePaths = await Effect.runPromise(
      listRuntimeEnabledOpenWaggleExtensionPackagePaths(PROJECT_PATH).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(enabledPackagePaths).toEqual([globalPackage.packagePath])
  })

  it('excludes project-disabled global packages from the Pi runtime allowlist', async () => {
    const harness = makeTestHarness({
      packages: [globalPackage],
      lifecycle: globalLifecycleState,
      projectOverride: {
        extensionId: 'global-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
        projectPath: PROJECT_PATH,
        disabled: true,
        createdAt: 3000,
        updatedAt: 4000,
      },
    })

    const enabledPackagePaths = await Effect.runPromise(
      listRuntimeEnabledOpenWaggleExtensionPackagePaths(PROJECT_PATH).pipe(
        Effect.provide(harness.layer),
      ),
    )

    expect(enabledPackagePaths).toEqual([])
  })

  it('stores project opt-outs in the user-local override repository without project settings writes', async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-extension-project-'))
    const projectPath = path.join(tmpRoot, 'project')
    const projectOpenWagglePath = path.join(projectPath, '.openwaggle')
    const packagePath = path.join(projectOpenWagglePath, 'extensions', 'sample-extension')

    try {
      await fs.mkdir(packagePath, { recursive: true })
      const projectPackage: DiscoveredExtensionPackage = {
        ...discoveredPackage,
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
        packagePath,
        manifestPath: path.join(packagePath, OPENWAGGLE_EXTENSION.MANIFEST_FILE),
      }
      const lifecycle = { ...lifecycleState, scope: projectPackage.scope }
      const harness = makeTestHarness({
        packages: [projectPackage],
        lifecycle,
      })

      await Effect.runPromise(
        setExtensionProjectDisabled({
          extensionId: 'sample-extension',
          scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
          projectPath,
          disabled: true,
        }).pipe(Effect.provide(harness.layer)),
      )

      expect(harness.getStoredProjectOverride()).toMatchObject({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath },
        projectPath,
        disabled: true,
      })
      await expect(fs.access(path.join(projectOpenWagglePath, 'settings.json'))).rejects.toThrow()
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true })
    }
  })
})
