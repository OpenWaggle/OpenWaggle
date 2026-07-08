import type { OPENWAGGLE_EXTENSION } from './constants.js'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number]
export type ExtensionContributionFamily = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY
>
export type ExtensionContributionRuntime = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME
>
export type ExtensionExecutionPlacement = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT
>
export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>
export type ExtensionNetworkAccessMode = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE
>

export interface ExtensionContributionTargetView {
  readonly projectPaths?: readonly string[]
  readonly sessionIds?: readonly string[]
}

export interface ExtensionContributionMatchView {
  readonly toolNames?: readonly string[]
  readonly customMessageNames?: readonly string[]
  readonly interactionKinds?: readonly string[]
}

export interface ExtensionContributionRegistration {
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
  readonly title: string
  readonly label?: string
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

export interface ExtensionContributionUnregistration {
  readonly family: ExtensionContributionFamily
  readonly contributionId: string
}

export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration
