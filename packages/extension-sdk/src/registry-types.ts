import type {
  ExtensionCapabilityScope,
  ExtensionContributionFamily,
  ExtensionContributionMatchView,
  ExtensionContributionRuntime,
  ExtensionContributionTargetView,
  ExtensionExecutionPlacement,
} from './contribution-types.js'

export type ExtensionPackageScopeKind = 'global' | 'project'

export interface ExtensionPackageScopeView {
  readonly kind: ExtensionPackageScopeKind
  readonly label: string
  readonly projectPath?: string
}

export interface ExtensionContributionRegistryEntry {
  readonly extensionId: string
  readonly extensionName: string
  readonly extensionVersion: string
  readonly scope: ExtensionPackageScopeView
  readonly packagePath: string
  readonly manifestPath: string
  readonly contentHash: string
  readonly projectPaths: readonly string[]
  readonly sessionId?: string
  readonly appliesToAllRequestedProjects: boolean
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
  readonly title: string
  readonly label: string
  readonly category?: string
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
  readonly declaredScopes?: readonly ExtensionCapabilityScope[]
  readonly networkOrigins?: readonly string[]
  readonly target?: ExtensionContributionTargetView
  readonly matches?: ExtensionContributionMatchView
  readonly runtime?: ExtensionContributionRuntime
  readonly execution?: ExtensionExecutionPlacement
  readonly entryPath?: string
}
