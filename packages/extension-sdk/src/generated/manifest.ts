// Generated from src/internal/type-sources/manifest.ts by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = 'app' | 'branch' | 'project' | 'session'

/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily =
  | 'commands'
  | 'customMessageRenderers'
  | 'dialogs'
  | 'interactionRenderers'
  | 'routes'
  | 'sessionSummarySections'
  | 'settingsSections'
  | 'sidePanels'
  | 'slashCommands'
  | 'statusWidgets'
  | 'toolRenderers'
  | 'transcriptRenderers'

/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = 'federated-module' | 'trusted-renderer'

/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = 'frame' | 'host-renderer'

/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = 'local-build' | 'prebuilt'

/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = {
  readonly projectPaths?: readonly string[]
  readonly sessionIds?: readonly string[]
}

/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = {
  readonly toolNames?: readonly string[]
  readonly customMessageNames?: readonly string[]
  readonly interactionKinds?: readonly string[]
}

/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = {
  readonly id: string
  readonly methods?: readonly string[]
  readonly scopes?: readonly ExtensionCapabilityScope[]
}

/** A command or slash command. */
export type ExtensionCommandContribution = {
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
  readonly id: string
  readonly title: string
  readonly category?: string
  readonly target?: ExtensionContributionTargetView
}

/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = {
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
  readonly id: string
  readonly title: string
  readonly runtime: ExtensionContributionRuntime
  readonly execution: ExtensionExecutionPlacement
  readonly entry: string
  readonly target?: ExtensionContributionTargetView
  readonly matches?: ExtensionContributionMatchView
}

/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = string | { readonly svg: string }

/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = {
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
  readonly id: string
  readonly title: string
  readonly runtime: ExtensionContributionRuntime
  readonly execution: ExtensionExecutionPlacement
  readonly entry: string
  readonly target?: ExtensionContributionTargetView
  readonly matches?: ExtensionContributionMatchView
  readonly icon?: ExtensionSidePanelIcon
}

/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution =
  | ExtensionSidePanelContribution
  | ExtensionSurfaceContribution

/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = {
  readonly id: string
  readonly label: string
  readonly value?: string
  readonly badge?: string
  readonly count?: number
  readonly resourceId?: string
  readonly action?: {
    readonly family: 'commands' | 'dialogs' | 'sidePanels'
    readonly contributionId: string
  }
}

/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = {
  readonly defaultExpanded?: boolean
  readonly collapsible?: boolean
  readonly autoCollapseAfterMs?: number
}

/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState =
  | { readonly status: 'failure'; readonly message: string }
  | { readonly status: 'live' | 'loading'; readonly message?: string }
  | { readonly status: 'ready' }

/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = {
  readonly id: string
  readonly title: string
  readonly placement?: 'context' | 'coordination' | 'details'
  readonly target?: ExtensionContributionTargetView
  readonly disclosure?: ExtensionSessionSummaryDisclosure
  readonly state?: ExtensionSessionSummaryState
  readonly rows: readonly ExtensionSessionSummaryRow[]
}

/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = {
  readonly commands?: readonly ExtensionCommandContribution[]
  readonly slashCommands?: readonly ExtensionCommandContribution[]
  readonly routes?: readonly ExtensionSurfaceContribution[]
  readonly settingsSections?: readonly ExtensionSurfaceContribution[]
  readonly sidePanels?: readonly ExtensionSidePanelContribution[]
  readonly dialogs?: readonly ExtensionSurfaceContribution[]
  readonly transcriptRenderers?: readonly ExtensionSurfaceContribution[]
  readonly toolRenderers?: readonly ExtensionSurfaceContribution[]
  readonly customMessageRenderers?: readonly ExtensionSurfaceContribution[]
  readonly interactionRenderers?: readonly ExtensionSurfaceContribution[]
  readonly statusWidgets?: readonly ExtensionSurfaceContribution[]
  readonly sessionSummarySections?: readonly ExtensionSessionSummaryContribution[]
}

/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration =
  | {
      readonly family: 'commands' | 'slashCommands'
      readonly contribution: ExtensionCommandContribution
    }
  | {
      readonly family:
        | 'customMessageRenderers'
        | 'dialogs'
        | 'interactionRenderers'
        | 'settingsSections'
        | 'statusWidgets'
        | 'toolRenderers'
        | 'transcriptRenderers'
      readonly contribution: ExtensionSurfaceContribution
    }
  | { readonly family: 'routes'; readonly contribution: ExtensionSurfaceContribution }
  | {
      readonly family: 'sessionSummarySections'
      readonly contribution: ExtensionSessionSummaryContribution
    }
  | { readonly family: 'sidePanels'; readonly contribution: ExtensionSidePanelContribution }

/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = {
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
}

/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = {
  readonly id: string
  readonly label: string
  readonly kind?: 'binary' | 'command'
  readonly command?: string
  readonly binary?: string
}

/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly description?: string
  readonly aliases?: readonly string[]
  readonly keywords?: readonly string[]
}

/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = {
  readonly manifestVersion: 1
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly sdk: { readonly openwaggle: string }
  readonly sourceFiles: readonly string[]
  readonly builtArtifacts: readonly string[]
  readonly install?: { readonly source: ExtensionInstallSource }
  readonly build?: { readonly command: string; readonly outputs?: readonly string[] }
  readonly docs?: { readonly topics?: readonly ExtensionDocsTopicDeclaration[] }
  readonly network?: { readonly origins: readonly string[] }
  readonly capabilities?: readonly ExtensionCapabilityDeclaration[]
  readonly contributions?: ExtensionContributions
  readonly pi?: { readonly resourceRoots?: readonly string[] }
  readonly trusted?: { readonly main?: string; readonly renderer?: string }
  readonly runtimeRequirements?: readonly ExtensionRuntimeRequirementDeclaration[]
}
