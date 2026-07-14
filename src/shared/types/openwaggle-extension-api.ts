import type { ExtensionInvokeInput, ExtensionInvokeResult } from './extension-broker'
import type {
  ExtensionFrameRegisterInput,
  ExtensionFrameRegisterResult,
  ExtensionFrameUnregisterInput,
} from './extension-frame'
import type {
  ExtensionAcceptUpdateInput,
  ExtensionApplyPackageRemoveInput,
  ExtensionApplyPackageWriteInput,
  ExtensionApproveBuildInput,
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
  ExtensionListPackagesInput,
  ExtensionManagerView,
  ExtensionPackageRemoveProposalView,
  ExtensionPackageWriteProposalView,
  ExtensionProposePackageRemoveInput,
  ExtensionProposePackageWriteInput,
  ExtensionReloadInput,
  ExtensionSetEnabledInput,
  ExtensionSetProjectDisabledInput,
  ExtensionSetTrustedInput,
} from './extensions'

export interface OpenWaggleExtensionApi {
  listExtensionPackages(input?: ExtensionListPackagesInput): Promise<ExtensionManagerView>
  listExtensionContributions(
    input?: ExtensionListContributionsInput,
  ): Promise<ExtensionContributionRegistryView>
  proposeExtensionPackageWrite(
    input: ExtensionProposePackageWriteInput,
  ): Promise<ExtensionPackageWriteProposalView>
  applyExtensionPackageWrite(input: ExtensionApplyPackageWriteInput): Promise<ExtensionManagerView>
  proposeExtensionPackageRemove(
    input: ExtensionProposePackageRemoveInput,
  ): Promise<ExtensionPackageRemoveProposalView>
  applyExtensionPackageRemove(
    input: ExtensionApplyPackageRemoveInput,
  ): Promise<ExtensionManagerView>
  invokeExtension(input: ExtensionInvokeInput): Promise<ExtensionInvokeResult>
  registerExtensionFrame(input: ExtensionFrameRegisterInput): Promise<ExtensionFrameRegisterResult>
  unregisterExtensionFrame(input: ExtensionFrameUnregisterInput): Promise<void>
  setExtensionTrusted(input: ExtensionSetTrustedInput): Promise<ExtensionManagerView>
  setExtensionEnabled(input: ExtensionSetEnabledInput): Promise<ExtensionManagerView>
  setExtensionProjectDisabled(
    input: ExtensionSetProjectDisabledInput,
  ): Promise<ExtensionManagerView>
  acceptExtensionUpdate(input: ExtensionAcceptUpdateInput): Promise<ExtensionManagerView>
  approveExtensionBuild(input: ExtensionApproveBuildInput): Promise<ExtensionManagerView>
  reloadExtension(input: ExtensionReloadInput): Promise<ExtensionManagerView>
}
