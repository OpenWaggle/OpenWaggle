import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createExtensionBrokerSdkFromInvoke,
  type ExtensionBrokerSdk,
  type ExtensionSdkInvoke,
} from '@shared/extension-sdk'
import type { ExtensionBrokerTransport } from '@shared/extension-sdk-core'
import {
  getContentHashRelativePaths,
  getManifestContentHashInput,
  normalizeManifestRelativePath,
} from '../adapters/extensions/content-hash-input'
import { loadExtensionManifest } from '../adapters/extensions/manifest-loader'
import {
  calculateContentHash,
  resolveSafePackageFilePath,
} from '../adapters/extensions/package-files'
import {
  createTrustedMainNetworkPolicy,
  runWithTrustedMainNetworkPolicy,
} from './trusted-main-network-egress'
import type { DiscoveredExtensionPackage, ExtensionPackageScope } from './types'

export const TRUSTED_MAIN_CONTRIBUTION_ID = 'openwaggle.trusted-main'

export interface TrustedMainExtensionIdentity {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly packagePath: string
  readonly scope: ExtensionPackageScope
  readonly contentHash: string
}

export interface TrustedMainExtensionContext {
  readonly extension: TrustedMainExtensionIdentity
  readonly sdk: ExtensionBrokerSdk
}

export type TrustedMainExtensionCleanup = () => void | Promise<void>
export type TrustedMainExtensionActivateResult = undefined | TrustedMainExtensionCleanup

export interface TrustedMainExtensionModule {
  readonly activate: (
    context: TrustedMainExtensionContext,
  ) => TrustedMainExtensionActivateResult | Promise<TrustedMainExtensionActivateResult>
}

export interface LoadedTrustedMainExtensionModule {
  readonly module: TrustedMainExtensionModule
  readonly entryPath: string
}

export type TrustedMainExtensionModuleLoader = (
  extensionPackage: DiscoveredExtensionPackage,
  contentHash: string,
) => Promise<LoadedTrustedMainExtensionModule>

function activateExport(value: object): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'activate')
  if (!descriptor) {
    return undefined
  }
  if ('value' in descriptor) {
    return descriptor.value
  }
  return descriptor.get?.call(value)
}

function defaultExport(value: object): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, 'default')
  if (!descriptor) {
    return undefined
  }
  if ('value' in descriptor) {
    return descriptor.value
  }
  return descriptor.get?.call(value)
}

export function hasTrustedMainRuntime(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.manifest?.trusted?.main !== undefined
}

function isDirectTrustedMainExtensionModule(value: unknown): value is TrustedMainExtensionModule {
  return typeof value === 'object' && value !== null && typeof activateExport(value) === 'function'
}

export function trustedMainExtensionModule(value: unknown): TrustedMainExtensionModule | null {
  if (isDirectTrustedMainExtensionModule(value)) {
    return value
  }
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const defaultValue = defaultExport(value)
  return isDirectTrustedMainExtensionModule(defaultValue) ? defaultValue : null
}

export function isTrustedMainExtensionModule(value: unknown): value is TrustedMainExtensionModule {
  return trustedMainExtensionModule(value) !== null
}

function trustedMainModuleImport(moduleUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ moduleUrl).then((moduleNamespace: unknown) => moduleNamespace)
}

function trustedMainModuleUrl(filePath: string, contentHash: string) {
  const url = pathToFileURL(filePath)
  url.searchParams.set('openwaggleExtensionContentHash', contentHash)
  return url.toString()
}

function exportSummary(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return typeof value
  }
  return Object.keys(value).sort().join(',') || '<none>'
}

function trustedMainEntry(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.manifest?.trusted?.main ?? null
}

function assertTrustedMainEntryIsHashCovered(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly relativePath: string
}) {
  const manifest = input.extensionPackage.manifest
  if (!manifest) {
    return false
  }

  const normalizedRelativePath = normalizeManifestRelativePath(input.relativePath)
  return getContentHashRelativePaths(getManifestContentHashInput(manifest)).includes(
    normalizedRelativePath,
  )
}

export async function resolveTrustedMainEntryFilePath(
  extensionPackage: DiscoveredExtensionPackage,
  contentHash: string,
) {
  const relativePath = trustedMainEntry(extensionPackage)
  if (!relativePath) {
    return null
  }
  if (!assertTrustedMainEntryIsHashCovered({ extensionPackage, relativePath })) {
    return null
  }

  const manifestResult = await loadExtensionManifest(extensionPackage.manifestPath)
  if (
    !manifestResult.manifest ||
    !manifestResult.rawManifest ||
    manifestResult.manifest.id !== extensionPackage.id ||
    manifestResult.manifest.id !== basename(extensionPackage.packagePath)
  ) {
    return null
  }

  const contentHashResult = await calculateContentHash(
    extensionPackage.packagePath,
    manifestResult.rawManifest,
    getManifestContentHashInput(manifestResult.manifest),
  )
  if (contentHashResult.contentHash !== contentHash) {
    return null
  }

  return resolveSafePackageFilePath(
    extensionPackage.packagePath,
    normalizeManifestRelativePath(relativePath),
  )
}

export async function importTrustedMainExtensionModule(
  extensionPackage: DiscoveredExtensionPackage,
  contentHash: string,
): Promise<LoadedTrustedMainExtensionModule> {
  const entryPath = await resolveTrustedMainEntryFilePath(extensionPackage, contentHash)
  if (!entryPath) {
    throw new Error(`Trusted main runtime entry for "${extensionPackage.id}" is unavailable.`)
  }

  const moduleNamespace = await trustedMainModuleImport(
    trustedMainModuleUrl(entryPath, contentHash),
  )
  const module = trustedMainExtensionModule(moduleNamespace)
  if (!module) {
    throw new Error(
      `Trusted main extension module must export an activate(context) function. Received exports: ${exportSummary(moduleNamespace)}.`,
    )
  }

  return { module, entryPath }
}

export function createTrustedMainExtensionContext(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly contentHash: string
  readonly transport: ExtensionBrokerTransport
}): TrustedMainExtensionContext {
  const manifest = input.extensionPackage.manifest
  const invoke: ExtensionSdkInvoke = (request) =>
    input.transport({
      extensionId: input.extensionPackage.id,
      contributionId: TRUSTED_MAIN_CONTRIBUTION_ID,
      capability: request.capability,
      method: request.method,
      scope: request.scope,
      ...(request.payload !== undefined ? { payload: request.payload } : {}),
    })

  return {
    extension: {
      id: input.extensionPackage.id,
      name: manifest?.name ?? input.extensionPackage.id,
      version: manifest?.version ?? '',
      packagePath: input.extensionPackage.packagePath,
      scope: input.extensionPackage.scope,
      contentHash: input.contentHash,
    },
    sdk: createExtensionBrokerSdkFromInvoke(invoke),
  }
}

export async function activateTrustedMainExtension(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly contentHash: string
  readonly transport: ExtensionBrokerTransport
  readonly loadModule?: TrustedMainExtensionModuleLoader
}) {
  const loader = input.loadModule ?? importTrustedMainExtensionModule
  const networkPolicy = createTrustedMainNetworkPolicy(input.extensionPackage)
  const loaded = await runWithTrustedMainNetworkPolicy(networkPolicy, () =>
    loader(input.extensionPackage, input.contentHash),
  )
  const cleanup = await runWithTrustedMainNetworkPolicy(networkPolicy, () => {
    const context = createTrustedMainExtensionContext({
      extensionPackage: input.extensionPackage,
      contentHash: input.contentHash,
      transport: input.transport,
    })
    return loaded.module.activate(context)
  })
  if (cleanup !== undefined && typeof cleanup !== 'function') {
    throw new Error(
      'Trusted main extension activate(context) must return a cleanup function or void.',
    )
  }

  return {
    entryPath: loaded.entryPath,
    cleanup:
      cleanup === undefined
        ? null
        : () => runWithTrustedMainNetworkPolicy(networkPolicy, () => cleanup()),
  }
}
