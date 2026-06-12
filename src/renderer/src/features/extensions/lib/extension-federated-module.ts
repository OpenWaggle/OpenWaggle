import {
  createNoopExtensionSurfaceSdk,
  createOpenWaggleExtensionSharedModules,
  createOpenWaggleExtensionSurfaceContext,
  type OpenWaggleExtensionSdk,
  type OpenWaggleExtensionSharedModules,
  type OpenWaggleExtensionSurfaceContext,
  type OpenWaggleExtensionSurfaceSdk,
} from '@shared/extension-context'
import { createExtensionBrokerSdk, type ExtensionSdkInvokeRequest } from '@shared/extension-sdk'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'
import { createRendererExtensionTheme } from './extension-theme-context'

export type ExtensionMountInvokeInput = ExtensionSdkInvokeRequest

export type { OpenWaggleExtensionSdk, OpenWaggleExtensionSurfaceSdk }

export interface OpenWaggleExtensionMountContext extends OpenWaggleExtensionSurfaceContext {
  readonly root: HTMLElement
  readonly sdk: OpenWaggleExtensionSdk
  readonly modules: OpenWaggleExtensionSharedModules
}

export type ExtensionFederatedModuleCleanup = () => void
export type ExtensionFederatedModuleMountResult = undefined | ExtensionFederatedModuleCleanup

export interface OpenWaggleFederatedModule {
  readonly mount: (
    context: OpenWaggleExtensionMountContext,
  ) => ExtensionFederatedModuleMountResult | Promise<ExtensionFederatedModuleMountResult>
}

export type ExtensionFederatedModuleLoader = (
  moduleUrl: string,
) => Promise<OpenWaggleFederatedModule>

function moduleMountExport(value: object): unknown {
  return Object.getOwnPropertyDescriptor(value, 'mount')?.value
}

export function isFederatedModule(value: unknown): value is OpenWaggleFederatedModule {
  return (
    typeof value === 'object' && value !== null && typeof moduleMountExport(value) === 'function'
  )
}

function runtimeModuleImport(moduleUrl: string): Promise<unknown> {
  return import(/* @vite-ignore */ moduleUrl).then((moduleNamespace: unknown) => moduleNamespace)
}

export async function importFederatedModule(moduleUrl: string): Promise<OpenWaggleFederatedModule> {
  const moduleNamespace = await runtimeModuleImport(moduleUrl)
  if (!isFederatedModule(moduleNamespace)) {
    throw new Error('Extension federated module must export a mount(context) function.')
  }

  return moduleNamespace
}

export function createExtensionMountContext(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly root: HTMLElement
  readonly surfacePayload?: JsonValue
  readonly invoke: (input: ExtensionInvokeInput) => Promise<ExtensionInvokeResult>
  readonly surface?: OpenWaggleExtensionSurfaceSdk
}): OpenWaggleExtensionMountContext {
  const brokerSdk = createExtensionBrokerSdk(input.invoke, {
    extensionId: input.entry.extensionId,
    contributionId: input.entry.contributionId,
  })
  const sdk = {
    ...brokerSdk,
    surface: input.surface ?? createNoopExtensionSurfaceSdk(),
  }
  const theme = createRendererExtensionTheme()

  return {
    ...createOpenWaggleExtensionSurfaceContext({
      entry: input.entry,
      surfacePayload: input.surfacePayload,
      theme,
    }),
    root: input.root,
    sdk,
    modules: createOpenWaggleExtensionSharedModules(theme),
  }
}
