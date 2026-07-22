import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import { ExtensionBuildRunner } from '../../ports/extension-build-runner'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { approveExtensionBuild, setExtensionTrusted } from '../extension-lifecycle-service'
import { TrustedMainActivationDependenciesTestLayer } from './extension-trusted-main-activation-test-layer'

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
  buildPlan: null,
  contentHash: 'abcdef',
  sdkCompatibility: {
    hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    requiredRange: '>=0.1.0 <0.2.0',
    compatible: true,
  },
  diagnostics: [],
}

function localBuildPackage(
  overrides: Partial<
    Pick<DiscoveredExtensionPackage, 'contentHash' | 'diagnostics' | 'sdkCompatibility'>
  > = {},
): DiscoveredExtensionPackage {
  return {
    ...discoveredPackage,
    ...overrides,
    buildPlan: {
      installSource: OPENWAGGLE_EXTENSION.INSTALL_SOURCE.LOCAL_BUILD,
      command: 'pnpm build',
      outputPaths: ['dist/index.js'],
      approvalRequired: true,
      inputHash: 'build-plan-hash',
    },
  }
}

function makeTestHarness({
  extensionPackage,
  buildExitCode = 0,
}: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly buildExitCode?: number
}) {
  let storedLifecycle: ExtensionLifecycleState | null = null
  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed([extensionPackage]),
      }),
      Layer.succeed(ExtensionBuildRunner, {
        run: () =>
          Effect.succeed({
            exitCode: buildExitCode,
            stdout: 'build stdout',
            stderr: buildExitCode === 0 ? '' : 'build stderr',
          }),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: () => Effect.sync(() => storedLifecycle),
        list: () => Effect.sync(() => (storedLifecycle ? [storedLifecycle] : [])),
        upsert: (state) =>
          Effect.sync(() => {
            storedLifecycle = state
          }),
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: () => Effect.succeed(null),
        upsert: () => Effect.void,
      }),
      TrustedMainActivationDependenciesTestLayer,
    ),
    getStoredLifecycle: () => storedLifecycle,
  }
}

describe('extension local build lifecycle', () => {
  it('runs and records a successful local build before trust pins the package', async () => {
    const harness = makeTestHarness({ extensionPackage: localBuildPackage() })

    await Effect.runPromise(
      approveExtensionBuild({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      }).pipe(Effect.provide(harness.layer)),
    )
    const view = await Effect.runPromise(
      setExtensionTrusted({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
        trusted: true,
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      approvedBuildPlanHash: 'build-plan-hash',
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.SUCCEEDED,
      grantedCapabilities: ['sample.invoke', OPENWAGGLE_EXTENSION.PRIVILEGE_GRANT.LOCAL_BUILD],
      contentHash: 'abcdef',
      trusted: true,
    })
    expect(view.packages[0]?.buildPlan).toMatchObject({
      approvalRequired: true,
      approved: true,
    })
  })

  it('records a failed local build without enabling the build plan', async () => {
    const harness = makeTestHarness({
      extensionPackage: localBuildPackage(),
      buildExitCode: 1,
    })

    const view = await Effect.runPromise(
      approveExtensionBuild({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      approvedBuildPlanHash: 'build-plan-hash',
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.FAILED,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'build-failed', severity: 'error' }),
      ]),
    })
    expect(harness.getStoredLifecycle()?.buildLog).toContain('build stderr')
    expect(view.packages[0]?.buildPlan).toMatchObject({
      approvalRequired: true,
      approved: false,
    })
    expect(view.packages[0]?.lifecycle).toMatchObject({
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.FAILED,
      trusted: false,
    })
  })

  it('records successful build commands as failed when artifacts are still invalid', async () => {
    const harness = makeTestHarness({
      extensionPackage: localBuildPackage({
        contentHash: null,
        diagnostics: [
          {
            severity: 'error',
            code: 'built-artifact-missing',
            message: 'Declared built artifact does not exist.',
            path: 'dist/index.js',
          },
        ],
      }),
    })

    const view = await Effect.runPromise(
      approveExtensionBuild({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      }).pipe(Effect.provide(harness.layer)),
    )

    expect(harness.getStoredLifecycle()).toMatchObject({
      approvedBuildPlanHash: 'build-plan-hash',
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.FAILED,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'build-artifacts-invalid', severity: 'error' }),
      ]),
    })
    expect(view.packages[0]?.buildPlan).toMatchObject({
      approvalRequired: true,
      approved: false,
    })
  })

  it('keeps successful builds approved when unrelated package diagnostics still block enablement', async () => {
    const harness = makeTestHarness({
      extensionPackage: localBuildPackage({
        sdkCompatibility: {
          hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
          requiredRange: '>=9.0.0',
          compatible: false,
        },
        diagnostics: [
          {
            severity: 'error',
            code: 'sdk-incompatible',
            message: 'SDK range is incompatible with this OpenWaggle host.',
          },
        ],
      }),
    })

    const view = await Effect.runPromise(
      approveExtensionBuild({
        extensionId: 'sample-extension',
        scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
      }).pipe(Effect.provide(harness.layer)),
    )
    const diagnosticCodes = harness
      .getStoredLifecycle()
      ?.diagnostics.map((diagnostic) => diagnostic.code)

    expect(harness.getStoredLifecycle()).toMatchObject({
      approvedBuildPlanHash: 'build-plan-hash',
      buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.SUCCEEDED,
    })
    expect(diagnosticCodes).toContain('sdk-incompatible')
    expect(diagnosticCodes).not.toContain('build-artifacts-invalid')
    expect(view.packages[0]?.buildPlan).toMatchObject({
      approvalRequired: true,
      approved: true,
    })
    expect(view.packages[0]?.sdkCompatibility).toMatchObject({
      compatible: false,
    })
  })
})
