import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { getExtensionGrantIds } from '../../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleKey,
  ExtensionLifecycleState,
  ExtensionPackageScope,
  ExtensionProjectOverrideKey,
  ExtensionProjectOverrideState,
} from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { TrustedMainActivationDependenciesTestLayer } from './extension-trusted-main-activation-test-layer'

export const PROJECT_PATH = '/tmp/project'
export const OTHER_PROJECT_PATH = '/tmp/other-project'

export const discoveredPackage: DiscoveredExtensionPackage = {
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

export const globalPackage: DiscoveredExtensionPackage = {
  ...discoveredPackage,
  id: 'global-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
  packagePath: '/tmp/user-data/extensions/global-extension',
  manifestPath: '/tmp/user-data/extensions/global-extension/openwaggle.extension.json',
  manifest: discoveredPackage.manifest
    ? { ...discoveredPackage.manifest, id: 'global-extension', name: 'Global Extension' }
    : null,
}

export const lifecycleState: ExtensionLifecycleState = {
  extensionId: 'sample-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND, projectPath: PROJECT_PATH },
  enabled: true,
  trusted: true,
  grantedCapabilities: ['sample.invoke'],
  contentHash: 'abcdef',
  packageVersion: '1.0.0',
  approvedBuildPlanHash: null,
  buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
  buildLog: null,
  reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED,
  lastReloadedAt: 3000,
  sdkRange: '>=0.1.0 <0.2.0',
  sdkCompatible: true,
  diagnostics: [],
  installedAt: 1000,
  updatedAt: 2000,
}

export const globalLifecycleState: ExtensionLifecycleState = {
  ...lifecycleState,
  extensionId: 'global-extension',
  scope: { kind: OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND },
}

export const globalTrustedMainPackage: DiscoveredExtensionPackage = {
  ...globalPackage,
  manifest: globalPackage.manifest
    ? {
        ...globalPackage.manifest,
        builtArtifacts: [...globalPackage.manifest.builtArtifacts, 'dist/main.mjs'],
        trusted: { main: 'dist/main.mjs' },
      }
    : null,
}

export const globalTrustedMainLifecycleState: ExtensionLifecycleState = {
  ...globalLifecycleState,
  grantedCapabilities: getExtensionGrantIds(globalTrustedMainPackage),
}

function scopeKey(scope: ExtensionPackageScope) {
  return scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
    ? `${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND}:${OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID}`
    : `${OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND}:${scope.projectPath}`
}

function scopesMatch(left: ExtensionPackageScope, right: ExtensionPackageScope) {
  return scopeKey(left) === scopeKey(right)
}

function lifecycleMatches(state: ExtensionLifecycleState, key: ExtensionLifecycleKey) {
  return state.extensionId === key.extensionId && scopesMatch(state.scope, key.scope)
}

function projectOverrideMatches(
  state: ExtensionProjectOverrideState,
  key: ExtensionProjectOverrideKey,
) {
  return (
    state.extensionId === key.extensionId &&
    state.projectPath === key.projectPath &&
    scopesMatch(state.scope, key.scope)
  )
}

export function makeProjectOverridesHarness({
  packages,
  lifecycle,
  projectOverride = null,
}: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverride?: ExtensionProjectOverrideState | null
}) {
  let storedProjectOverrides = projectOverride ? [projectOverride] : []
  return {
    layer: Layer.mergeAll(
      Layer.succeed(ExtensionManagerService, {
        listPackages: () => Effect.succeed(packages),
      }),
      Layer.succeed(ExtensionLifecycleRepository, {
        get: (key) =>
          Effect.sync(() => (lifecycle && lifecycleMatches(lifecycle, key) ? lifecycle : null)),
        list: (scope) =>
          Effect.sync(() => (lifecycle && scopesMatch(lifecycle.scope, scope) ? [lifecycle] : [])),
        upsert: () => Effect.void,
      }),
      Layer.succeed(ExtensionProjectOverridesRepository, {
        get: (key) =>
          Effect.sync(
            () =>
              storedProjectOverrides.find((override) => projectOverrideMatches(override, key)) ??
              null,
          ),
        upsert: (state) =>
          Effect.sync(() => {
            storedProjectOverrides = [
              ...storedProjectOverrides.filter(
                (override) => !projectOverrideMatches(override, state),
              ),
              state,
            ]
          }),
      }),
      TrustedMainActivationDependenciesTestLayer,
    ),
    getStoredProjectOverride: () => storedProjectOverrides[0] ?? null,
  }
}
