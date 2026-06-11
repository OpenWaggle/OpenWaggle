import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { listExtensionPackagesView } from '../extension-manager-view-service'

const PROJECT_PATH = '/tmp/project'

const discoveredManifest = {
  manifestVersion: 1,
  id: 'sample-extension',
  name: 'Sample Extension',
  version: '1.0.0',
  sdk: { openwaggle: '>=0.1.0 <0.2.0' },
  sourceFiles: ['src/index.ts'],
  builtArtifacts: ['dist/index.js'],
} satisfies NonNullable<DiscoveredExtensionPackage['manifest']>

const discoveredPackage: DiscoveredExtensionPackage = {
  id: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  packagePath: '/tmp/project/.openwaggle/extensions/sample-extension',
  manifestPath: '/tmp/project/.openwaggle/extensions/sample-extension/openwaggle.extension.json',
  manifest: discoveredManifest,
  buildPlan: null,
  contentHash: 'abcdef',
  sdkCompatibility: {
    hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  diagnostics: [],
}

function testLayer(
  extensionPackage: DiscoveredExtensionPackage,
  lifecycle: ExtensionLifecycleState | null = null,
) {
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.succeed([extensionPackage]),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.succeed(lifecycle),
      list: () => Effect.succeed(lifecycle ? [lifecycle] : []),
      upsert: () => Effect.void,
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: () => Effect.succeed(null),
      upsert: () => Effect.void,
    }),
  )
}

describe('listExtensionPackagesView requirements', () => {
  it('projects runtime and privileged requirements before trust or enablement', async () => {
    const privilegedManifest = {
      manifestVersion: 1,
      id: 'sample-extension',
      name: 'Sample Extension',
      version: '1.0.0',
      sdk: { openwaggle: '>=0.1.0 <0.2.0' },
      sourceFiles: ['src/index.ts'],
      builtArtifacts: ['dist/index.js', 'dist/main.js', 'dist/renderer.js'],
      install: { source: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD },
      build: {
        command: 'pnpm build',
        outputs: ['dist/index.js'],
      },
      runtimeRequirements: [
        {
          kind: OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPE.BINARY,
          id: 'sample.ripgrep',
          label: 'Ripgrep',
          binary: 'rg',
        },
        {
          kind: OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_TYPE.COMMAND,
          id: 'sample.provider',
          label: 'Provider module',
          command: 'extensions/provider.js',
        },
      ],
      capabilities: [
        {
          id: 'sample.invoke',
          methods: ['run'],
          scopes: ['project'],
        },
      ],
      network: {
        origins: ['https://api.github.com'],
      },
      trusted: {
        main: 'dist/main.js',
        renderer: 'dist/renderer.js',
      },
      contributions: {
        sidePanels: [
          {
            id: 'sample.panel',
            title: 'Sample Panel',
            runtime: OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE,
            execution: OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT.FRAME,
            entry: 'dist/renderer.js',
            capability: 'sample.invoke',
            method: 'run',
          },
        ],
      },
    } satisfies NonNullable<DiscoveredExtensionPackage['manifest']>
    const privilegedPackage: DiscoveredExtensionPackage = {
      ...discoveredPackage,
      manifest: privilegedManifest,
      buildPlan: {
        installSource: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD,
        command: 'pnpm build',
        outputPaths: ['dist/index.js'],
        approvalRequired: true,
        inputHash: 'build-plan-hash',
      },
    }

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(testLayer(privilegedPackage)),
      ),
    )

    expect(view.packages[0]?.requirements?.runtime).toEqual([
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_BINARY,
        id: 'sample.ripgrep',
        label: 'Ripgrep',
        resolution: OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_RESOLUTION.DIAGNOSTIC_ONLY,
        binary: 'rg',
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_COMMAND,
        id: 'sample.provider',
        label: 'Provider module',
        resolution: OPENWAGGLE_EXTENSION.RUNTIME_REQUIREMENT_RESOLUTION.DIAGNOSTIC_ONLY,
        path: 'extensions/provider.js',
      },
    ])
    expect(view.packages[0]?.requirements?.privileges).toEqual([
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_CAPABILITY,
        id: 'sample.invoke',
        label: 'Capability: sample.invoke',
        grantId: 'sample.invoke',
        consentRequired: true,
        granted: false,
        capabilityId: 'sample.invoke',
        methods: ['run'],
        scopes: ['project'],
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_NETWORK,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
        label: 'Network access',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
        consentRequired: true,
        granted: false,
        origins: ['https://api.github.com'],
        accessModes: [
          OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE.DIRECT,
          OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE.RESTRICTED,
        ],
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_LOCAL_BUILD,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
        label: 'Local build step',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
        consentRequired: true,
        granted: false,
        command: 'pnpm build',
        outputCount: 1,
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_MAIN,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
        label: 'Trusted main-process runtime',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
        consentRequired: true,
        granted: false,
        path: 'dist/main.js',
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_RENDERER,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
        label: 'Trusted renderer runtime',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
        consentRequired: true,
        granted: false,
        path: 'dist/renderer.js',
      },
    ])
    expect(view.packages[0]?.requirements?.consentRequired).toBe(true)
    expect(view.packages[0]?.requirements?.missingGrantIds).toEqual([
      'sample.invoke',
      OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
      OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
      OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
      OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
    ])
  })

  it('projects empty requirement details for legacy manifests', async () => {
    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(testLayer(discoveredPackage)),
      ),
    )

    expect(view.packages[0]?.requirements).toEqual({
      runtime: [],
      privileges: [],
      consentRequired: false,
      missingGrantIds: [],
    })
  })

  it('marks current trust grants as granted for the active package hash', async () => {
    const networkPackage: DiscoveredExtensionPackage = {
      ...discoveredPackage,
      manifest: {
        ...discoveredManifest,
        network: { origins: ['https://api.github.com'] },
      },
    }
    const lifecycle = {
      extensionId: 'sample-extension',
      scope: discoveredPackage.scope,
      enabled: false,
      trusted: true,
      grantedCapabilities: [OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK],
      contentHash: 'abcdef',
      packageVersion: '1.0.0',
      approvedBuildPlanHash: null,
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
      buildLog: null,
      reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
      lastReloadedAt: null,
      sdkRange: '>=0.1.0 <0.2.0',
      sdkCompatible: true,
      diagnostics: [],
      installedAt: 1000,
      updatedAt: 2000,
    } satisfies ExtensionLifecycleState

    const view = await Effect.runPromise(
      listExtensionPackagesView({ projectPaths: [PROJECT_PATH] }).pipe(
        Effect.provide(testLayer(networkPackage, lifecycle)),
      ),
    )

    expect(view.packages[0]?.requirements?.privileges).toEqual([
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_NETWORK,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
        label: 'Network access',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
        consentRequired: true,
        granted: true,
        origins: ['https://api.github.com'],
        accessModes: [OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE.BROKERED],
      },
    ])
    expect(view.packages[0]?.requirements?.missingGrantIds).toEqual([])
  })
})
