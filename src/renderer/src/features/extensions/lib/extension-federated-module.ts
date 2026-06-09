import {
  createExtensionBrokerSdk,
  type ExtensionBrokerSdk,
  type ExtensionSdkInvokeRequest,
} from '@shared/extension-sdk'
import type { ExtensionInvokeInput, ExtensionInvokeResult } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { JsonValue } from '@shared/types/json'

export type ExtensionMountInvokeInput = ExtensionSdkInvokeRequest

export interface OpenWaggleExtensionSurfaceSdk {
  readonly sendAction: (actionId: string, payload?: JsonValue) => Promise<void>
  readonly respondInteraction: (value: JsonValue | null) => Promise<void>
}

export type OpenWaggleExtensionSdk = ExtensionBrokerSdk & {
  readonly surface: OpenWaggleExtensionSurfaceSdk
}

export interface OpenWaggleExtensionMountContext {
  readonly root: HTMLElement
  readonly extension: {
    readonly id: string
    readonly name: string
    readonly version: string
  }
  readonly contribution: {
    readonly id: string
    readonly title: string
    readonly family: string
  }
  readonly surface: {
    readonly family: string
    readonly execution: string
    readonly payload?: JsonValue
  }
  readonly packagePath: string
  readonly projectPaths: readonly string[]
  readonly theme: {
    readonly colorScheme: 'dark'
  }
  readonly sdk: OpenWaggleExtensionSdk
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
    surface: input.surface ?? {
      sendAction: async () => undefined,
      respondInteraction: async () => undefined,
    },
  }

  return {
    root: input.root,
    extension: {
      id: input.entry.extensionId,
      name: input.entry.extensionName,
      version: input.entry.extensionVersion,
    },
    contribution: {
      id: input.entry.contributionId,
      title: input.entry.title,
      family: input.entry.family,
    },
    surface: {
      family: input.entry.family,
      execution: input.entry.execution ?? '',
      ...(input.surfacePayload !== undefined ? { payload: input.surfacePayload } : {}),
    },
    packagePath: input.entry.packagePath,
    projectPaths: input.entry.projectPaths,
    theme: {
      colorScheme: 'dark',
    },
    sdk,
  }
}
