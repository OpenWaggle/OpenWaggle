import { createHash } from 'node:crypto'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { OpenWaggleExtensionManifest } from '@shared/schemas/extensions'
import type { ExtensionContributionRegistryView } from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { getExtensionGrantIds } from '../../extensions/runtime-eligibility'
import type {
  DiscoveredExtensionPackage,
  ExtensionLifecycleState,
  ExtensionPackageScope,
  ExtensionProjectOverrideState,
  ExtensionReloadStatus,
} from '../../extensions/types'
import { ExtensionLifecycleRepository } from '../../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../../ports/extension-project-overrides-repository'
import { listExtensionContributionRegistryView } from '../extension-contribution-registry-service'

export const PROJECT_PATH = '/tmp/project'
export const OTHER_PROJECT_PATH = '/tmp/other-project'

const SDK_RANGE = '>=0.1.0 <0.2.0'

function makeManifest(input: {
  readonly id: string
  readonly name: string
  readonly capabilities?: OpenWaggleExtensionManifest['capabilities']
  readonly network?: OpenWaggleExtensionManifest['network']
  readonly trusted?: OpenWaggleExtensionManifest['trusted']
  readonly contributions: NonNullable<OpenWaggleExtensionManifest['contributions']>
}): OpenWaggleExtensionManifest {
  return {
    manifestVersion: 1,
    id: input.id,
    name: input.name,
    version: '1.0.0',
    sdk: { openwaggle: SDK_RANGE },
    sourceFiles: ['src/index.ts'],
    builtArtifacts: ['dist/index.js'],
    ...(input.capabilities !== undefined ? { capabilities: input.capabilities } : {}),
    ...(input.network !== undefined ? { network: input.network } : {}),
    ...(input.trusted !== undefined ? { trusted: input.trusted } : {}),
    contributions: input.contributions,
  }
}

function packagePathForScope(extensionId: string, scope: ExtensionPackageScope) {
  if (scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return `/tmp/user-data/extensions/${extensionId}`
  }

  return `${scope.projectPath}/.openwaggle/extensions/${extensionId}`
}

export function makePackage(input: {
  readonly id: string
  readonly name: string
  readonly scope: ExtensionPackageScope
  readonly capabilities?: OpenWaggleExtensionManifest['capabilities']
  readonly network?: OpenWaggleExtensionManifest['network']
  readonly trusted?: OpenWaggleExtensionManifest['trusted']
  readonly contributions: NonNullable<OpenWaggleExtensionManifest['contributions']>
  readonly contentHash?: string
}): DiscoveredExtensionPackage {
  const packagePath = packagePathForScope(input.id, input.scope)
  const manifest = makeManifest({
    id: input.id,
    name: input.name,
    capabilities: input.capabilities,
    network: input.network,
    trusted: input.trusted,
    contributions: input.contributions,
  })
  const contentHash =
    input.contentHash ??
    createHash('sha256')
      .update(
        JSON.stringify({
          manifest,
          packagePath,
          scope: input.scope,
        }),
      )
      .digest('hex')

  return {
    id: input.id,
    scope: input.scope,
    packagePath,
    manifestPath: `${packagePath}/${OPENWAGGLE_EXTENSION.MANIFEST_FILE}`,
    manifest,
    buildPlan: null,
    contentHash,
    sdkCompatibility: {
      hostVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
      requiredRange: SDK_RANGE,
      compatible: true,
    },
    diagnostics: [],
  }
}

export function makeLifecycle(
  extensionPackage: DiscoveredExtensionPackage,
  options: {
    readonly enabled?: boolean
    readonly trusted?: boolean
    readonly grantedCapabilities?: readonly string[]
    readonly reloadStatus?: ExtensionReloadStatus
    readonly lastReloadedAt?: number | null
  } = {},
): ExtensionLifecycleState {
  const reloadStatus = options.reloadStatus ?? OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED
  return {
    extensionId: extensionPackage.id,
    scope: extensionPackage.scope,
    enabled: options.enabled ?? true,
    trusted: options.trusted ?? true,
    grantedCapabilities: options.grantedCapabilities ?? getExtensionGrantIds(extensionPackage),
    contentHash: extensionPackage.contentHash,
    packageVersion: extensionPackage.manifest?.version ?? null,
    approvedBuildPlanHash: null,
    buildStatus: OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.NOT_RUN,
    buildLog: null,
    reloadStatus,
    lastReloadedAt:
      options.lastReloadedAt !== undefined
        ? options.lastReloadedAt
        : reloadStatus === OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED
          ? 3000
          : null,
    sdkRange: extensionPackage.manifest?.sdk.openwaggle ?? null,
    sdkCompatible: extensionPackage.sdkCompatibility?.compatible ?? false,
    diagnostics: [],
    installedAt: 1000,
    updatedAt: 2000,
  }
}

export function makeProjectOverride(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly projectPath: string
  readonly disabled: boolean
}): ExtensionProjectOverrideState {
  return {
    extensionId: input.extensionPackage.id,
    scope: input.extensionPackage.scope,
    projectPath: input.projectPath,
    disabled: input.disabled,
    createdAt: 3000,
    updatedAt: 4000,
  }
}

function scopesMatch(left: ExtensionPackageScope, right: ExtensionPackageScope) {
  if (left.kind !== right.kind) {
    return false
  }
  if (left.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return true
  }

  return (
    right.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND && left.projectPath === right.projectPath
  )
}

export function makeContributionRegistryTestLayer(input: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycles: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ExtensionProjectOverrideState[]
}) {
  const projectOverrides = input.projectOverrides ?? []
  return Layer.mergeAll(
    Layer.succeed(ExtensionManagerService, {
      listPackages: () => Effect.succeed(input.packages),
    }),
    Layer.succeed(ExtensionLifecycleRepository, {
      get: (key) =>
        Effect.succeed(
          input.lifecycles.find(
            (lifecycle) =>
              lifecycle.extensionId === key.extensionId && scopesMatch(lifecycle.scope, key.scope),
          ) ?? null,
        ),
      list: (scope) =>
        Effect.succeed(input.lifecycles.filter((lifecycle) => scopesMatch(lifecycle.scope, scope))),
      upsert: () => Effect.void,
    }),
    Layer.succeed(ExtensionProjectOverridesRepository, {
      get: (key) =>
        Effect.succeed(
          projectOverrides.find(
            (projectOverride) =>
              projectOverride.extensionId === key.extensionId &&
              scopesMatch(projectOverride.scope, key.scope) &&
              projectOverride.projectPath === key.projectPath,
          ) ?? null,
        ),
      upsert: () => Effect.void,
    }),
  )
}

export async function loadRegistry(input: {
  readonly packages: readonly DiscoveredExtensionPackage[]
  readonly lifecycles: readonly ExtensionLifecycleState[]
  readonly projectOverrides?: readonly ExtensionProjectOverrideState[]
  readonly projectPaths: readonly string[]
  readonly sessionId?: string
}) {
  return Effect.runPromise(
    listExtensionContributionRegistryView({
      projectPaths: input.projectPaths,
      ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    }).pipe(Effect.provide(makeContributionRegistryTestLayer(input))),
  )
}

export function expectFirstEntry(registry: ExtensionContributionRegistryView) {
  const entry = registry.entries[0]
  if (!entry) {
    throw new Error('Expected registry to include at least one contribution entry.')
  }
  return entry
}
