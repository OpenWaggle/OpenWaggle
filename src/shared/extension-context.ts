import { OPENWAGGLE_EXTENSION } from './constants/extensions'
import type { ExtensionBrokerSdk } from './extension-sdk'
import {
  createOpenWaggleExtensionTheme,
  extensionThemeCssVariableEntries,
  type OpenWaggleExtensionTheme,
} from './extension-theme'
import {
  createOpenWaggleExtensionUiStylesheet,
  OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
  openWaggleExtensionClassName,
} from './extension-ui'
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

export interface OpenWaggleExtensionSharedModules {
  readonly sdk: {
    readonly openWaggleVersion: string
  }
  readonly theme: {
    readonly current: OpenWaggleExtensionTheme
    readonly createTheme: typeof createOpenWaggleExtensionTheme
    readonly cssVariableEntries: typeof extensionThemeCssVariableEntries
  }
  readonly ui: {
    readonly classNames: typeof OPENWAGGLE_EXTENSION_UI_CLASS_NAMES
    readonly attributes: typeof OPENWAGGLE_EXTENSION_UI_ATTRIBUTES
    readonly className: typeof openWaggleExtensionClassName
    readonly createStylesheet: typeof createOpenWaggleExtensionUiStylesheet
  }
}

export interface OpenWaggleExtensionMountContext extends OpenWaggleExtensionSurfaceContext {
  readonly root: HTMLElement
  readonly sdk: OpenWaggleExtensionSdk
  readonly modules: OpenWaggleExtensionSharedModules
}

export type OpenWaggleExtensionMountCleanup = () => void
export type OpenWaggleExtensionMountResult = undefined | OpenWaggleExtensionMountCleanup

export interface OpenWaggleFederatedModule {
  readonly mount: (
    context: OpenWaggleExtensionMountContext,
  ) => OpenWaggleExtensionMountResult | Promise<OpenWaggleExtensionMountResult>
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

export function createOpenWaggleExtensionSharedModules(
  theme: OpenWaggleExtensionTheme = createOpenWaggleExtensionTheme(),
): OpenWaggleExtensionSharedModules {
  return {
    sdk: {
      openWaggleVersion: OPENWAGGLE_EXTENSION.SDK_VERSION,
    },
    theme: {
      current: theme,
      createTheme: createOpenWaggleExtensionTheme,
      cssVariableEntries: extensionThemeCssVariableEntries,
    },
    ui: {
      classNames: OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
      attributes: OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
      className: openWaggleExtensionClassName,
      createStylesheet: createOpenWaggleExtensionUiStylesheet,
    },
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
