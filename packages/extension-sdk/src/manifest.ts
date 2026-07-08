import type { OPENWAGGLE_EXTENSION } from './constants.js'
import type {
  ExtensionCapabilityScope,
  ExtensionContributionRuntime,
  ExtensionExecutionPlacement,
  ExtensionInstallSource,
  ExtensionNetworkAccessMode,
} from './types.js'

export interface ExtensionCapabilityDeclaration {
  readonly id: string
  readonly methods?: readonly string[]
  readonly scopes?: readonly ExtensionCapabilityScope[]
}

export interface ExtensionContributionBase {
  readonly id: string
  readonly title: string
  readonly label?: string
  readonly category?: string
  readonly target?: {
    readonly projectPaths?: readonly string[]
    readonly sessionIds?: readonly string[]
  }
  readonly matches?: {
    readonly toolNames?: readonly string[]
    readonly customMessageNames?: readonly string[]
    readonly interactionKinds?: readonly string[]
  }
}

export interface ExtensionCommandContribution extends ExtensionContributionBase {
  readonly capability?: string
  readonly method?: string
}

export interface ExtensionEntryContribution extends ExtensionContributionBase {
  readonly runtime: ExtensionContributionRuntime
  readonly execution?: ExtensionExecutionPlacement
  readonly entry: string
}

export interface ExtensionContributions {
  readonly commands?: readonly ExtensionCommandContribution[]
  readonly slashCommands?: readonly ExtensionCommandContribution[]
  readonly routes?: readonly ExtensionEntryContribution[]
  readonly settingsSections?: readonly ExtensionEntryContribution[]
  readonly sidePanels?: readonly ExtensionEntryContribution[]
  readonly dialogs?: readonly ExtensionEntryContribution[]
  readonly transcriptRenderers?: readonly ExtensionEntryContribution[]
  readonly toolRenderers?: readonly ExtensionEntryContribution[]
  readonly customMessageRenderers?: readonly ExtensionEntryContribution[]
  readonly interactionRenderers?: readonly ExtensionEntryContribution[]
  readonly statusWidgets?: readonly ExtensionEntryContribution[]
}

export interface ExtensionRuntimeRequirementDeclaration {
  readonly id: string
  readonly label: string
  readonly kind?: 'binary' | 'command'
  readonly command?: string
  readonly binary?: string
}

export interface OpenWaggleExtensionManifest {
  readonly manifestVersion: 1
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly sdk: {
    readonly openwaggle: string
  }
  readonly sourceFiles: readonly string[]
  readonly builtArtifacts: readonly string[]
  readonly install?: {
    readonly source: ExtensionInstallSource
  }
  readonly build?: {
    readonly command: string
    readonly outputs?: readonly string[]
  }
  readonly docs?: {
    readonly topics?: readonly {
      readonly id: string
      readonly title: string
      readonly path: string
      readonly description?: string
      readonly aliases?: readonly string[]
      readonly keywords?: readonly string[]
    }[]
  }
  readonly network?: {
    readonly origins: readonly string[]
    readonly accessModes?: readonly ExtensionNetworkAccessMode[]
  }
  readonly capabilities?: readonly ExtensionCapabilityDeclaration[]
  readonly contributions?: ExtensionContributions
  readonly pi?: {
    readonly resourceRoots?: readonly string[]
  }
  readonly trusted?: {
    readonly main?: string
    readonly renderer?: string
  }
  readonly runtimeRequirements?: readonly ExtensionRuntimeRequirementDeclaration[]
}

export type OpenWaggleExtensionManifestFile = typeof OPENWAGGLE_EXTENSION.MANIFEST_FILE
