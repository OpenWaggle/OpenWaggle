import type { OPENWAGGLE_EXTENSION } from './constants.js'
import type {
  ExtensionContributionRegistration as ManifestContributionRegistration,
  ExtensionContributionUnregistration as ManifestContributionUnregistration,
} from './manifest.js'

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

export type ExtensionRuntimeRegisterContributionPayload = ManifestContributionRegistration
export type ExtensionRuntimeUnregisterContributionPayload = ManifestContributionUnregistration
