import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { listExtensionPackagesView } from '../extension-manager-view-service'

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
  },
  buildPlan: null,
  contentHash: 'abcdef',
  sdkCompatibility: {
    hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  diagnostics: [],
}

function testLayer(extensionPackage: DiscoveredExtensionPackage) {
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.succeed([extensionPackage]),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: () => Effect.succeed(null),
      list: () => Effect.succeed([]),
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
        binary: 'rg',
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.RUNTIME_COMMAND,
        id: 'sample.provider',
        label: 'Provider module',
        path: 'extensions/provider.js',
      },
    ])
    expect(view.packages[0]?.requirements?.privileges).toEqual([
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_CAPABILITY,
        id: 'sample.invoke',
        label: 'Capability: sample.invoke',
        grantId: 'sample.invoke',
        capabilityId: 'sample.invoke',
        methods: ['run'],
        scopes: ['project'],
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_NETWORK,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
        label: 'Network access',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.NETWORK,
        origins: ['https://api.github.com'],
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_LOCAL_BUILD,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
        label: 'Local build step',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD,
        command: 'pnpm build',
        outputCount: 1,
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_MAIN,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
        label: 'Trusted main-process runtime',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_MAIN,
        path: 'dist/main.js',
      },
      {
        kind: OPENWAGGLE_EXTENSION.REQUIREMENT_KIND.PRIVILEGED_TRUSTED_RENDERER,
        id: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
        label: 'Trusted renderer runtime',
        grantId: OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.TRUSTED_RENDERER,
        path: 'dist/renderer.js',
      },
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
    })
  })
})
