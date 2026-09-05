import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionPackageScopeView } from './extension-package-scope'

type ConstantValue<TObject> = TObject[keyof TObject]

type ExtensionDiagnosticSeverity = ConstantValue<typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.SEVERITY>
type ExtensionDiagnosticCode = ConstantValue<typeof OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE>
type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number]
type ExtensionContributionFamily = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY>
type ExtensionContributionRuntime = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME>
type ExtensionExecutionPlacement = ConstantValue<typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT>

interface ExtensionDiagnosticView {
  readonly severity: ExtensionDiagnosticSeverity
  readonly code: ExtensionDiagnosticCode
  readonly message: string
  readonly path?: string
}

export interface ExtensionListContributionsInput {
  readonly projectPaths?: readonly string[]
  readonly sessionId?: string
}

export interface ExtensionContributionEligibilityView {
  readonly runtimeEnabled: boolean
  readonly enabled: boolean
  readonly trusted: boolean
  readonly sdkCompatible: boolean | null
  readonly updateAvailable: boolean
  readonly disabledProjectPaths: readonly string[]
}

export interface ExtensionContributionTargetView {
  readonly projectPaths?: readonly string[]
  readonly sessionIds?: readonly string[]
}

export interface ExtensionContributionMatchView {
  readonly toolNames?: readonly string[]
  readonly customMessageNames?: readonly string[]
  readonly interactionKinds?: readonly string[]
}

export interface ExtensionSessionSummaryActionView {
  readonly family: 'commands' | 'sidePanels' | 'dialogs'
  readonly contributionId: string
}

export interface ExtensionSessionSummaryRowView {
  readonly id: string
  readonly label: string
  readonly value?: string
  readonly badge?: string
  readonly count?: number
  readonly resourceId?: string
  readonly action?: ExtensionSessionSummaryActionView
}

export interface ExtensionSessionSummaryView {
  readonly placement: 'context' | 'coordination' | 'details'
  readonly rows: readonly ExtensionSessionSummaryRowView[]
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
  readonly sessionSummary?: ExtensionSessionSummaryView
  readonly eligibility: ExtensionContributionEligibilityView
  readonly diagnostics: readonly ExtensionDiagnosticView[]
}

export interface ExtensionContributionRegistryView {
  readonly projectPaths: readonly string[]
  readonly entries: readonly ExtensionContributionRegistryEntry[]
  readonly diagnostics?: readonly ExtensionDiagnosticView[]
}
