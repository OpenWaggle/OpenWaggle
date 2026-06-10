import type { ExtensionBrokerSdk } from './extension-sdk'
import { createOpenWaggleExtensionTheme, type OpenWaggleExtensionTheme } from './extension-theme'
import type { ExtensionContributionRegistryEntry } from './types/extensions'
import type { JsonValue } from './types/json'

export interface OpenWaggleExtensionSurfaceContext {
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
  readonly theme: OpenWaggleExtensionTheme
}

export interface OpenWaggleExtensionSurfaceSdk {
  readonly sendAction: (actionId: string, payload?: JsonValue) => Promise<void>
  readonly respondInteraction: (value: JsonValue | null) => Promise<void>
}

export type OpenWaggleExtensionSdk = ExtensionBrokerSdk & {
  readonly surface: OpenWaggleExtensionSurfaceSdk
}

export interface CreateOpenWaggleExtensionSurfaceContextInput {
  readonly entry: ExtensionContributionRegistryEntry
  readonly surfacePayload?: JsonValue
  readonly theme?: OpenWaggleExtensionTheme
}

export function createNoopExtensionSurfaceSdk(): OpenWaggleExtensionSurfaceSdk {
  return {
    sendAction: async () => undefined,
    respondInteraction: async () => undefined,
  }
}

export function createOpenWaggleExtensionSurfaceContext(
  input: CreateOpenWaggleExtensionSurfaceContextInput,
): OpenWaggleExtensionSurfaceContext {
  return {
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
    theme: input.theme ?? createOpenWaggleExtensionTheme(),
  }
}
