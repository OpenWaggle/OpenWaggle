// Components stay out of this root index: the eager shell imports it for hooks, state and
// helpers, and re-exporting components here pulled them into the initial renderer graph
// (renderer-load B8). Import components from `@/features/extensions/components`.
// Only the light pieces the shell and transcript render are exported here: the Panel rail icon
// and the agent-loop surfaces.
export { ExtensionAgentLoopStatusWidgets } from './components/ExtensionAgentLoopStatusWidgets'
export {
  CUSTOM_INTERACTION_RESPONSE_ACTION_ID,
  CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID,
  ExtensionAgentLoopSurface,
  type ExtensionAgentLoopSurfaceInput,
  type ExtensionCustomMessageView,
  type ExtensionInteractionActionView,
  type ExtensionInteractionView,
  type ExtensionStatusView,
  type ExtensionToolResultView,
} from './components/ExtensionAgentLoopSurface'
export { ExtensionPanelIcon } from './components/ExtensionPanelIcon'
export { useExtensionSidePanelContributions } from './hooks/useExtensionSidePanelContributions'
export {
  agentLoopAuxiliarySurfacePayload,
  agentLoopInputKey,
  type ExtensionAgentLoopAuxiliaryContribution,
  type ExtensionAgentLoopAuxiliaryPlacement,
  interactionSurfaceInput,
  resolveExtensionAgentLoopAuxiliaryContributions,
} from './lib/extension-agent-loop-auxiliary-surfaces'
export type {
  ExtensionAgentLoopResolution,
  ExtensionAgentLoopSurfaceKind,
  ExtensionAgentLoopTarget,
  ResolvedExtensionAgentLoopContribution,
} from './lib/extension-agent-loop-resolution'
export {
  extensionAgentLoopEntryMatchesTarget,
  resolveExtensionAgentLoopContribution,
  resolveExtensionAgentLoopContributionEntries,
} from './lib/extension-agent-loop-resolution'
export {
  surfaceLabel,
  surfacePayload,
  surfaceTarget,
} from './lib/extension-agent-loop-surface-model'
export { refreshPreferencesAfterExtensionInvoke } from './lib/extension-broker-preferences'
export { invokeBoundExtension } from './lib/extension-contribution-invocation'
export type {
  ExtensionDialogResolution,
  ExtensionDialogTarget,
  ResolvedExtensionDialogContribution,
} from './lib/extension-dialog-resolution'
export { resolveExtensionDialogContribution } from './lib/extension-dialog-resolution'
export type {
  ExtensionFederatedModuleLoader,
  OpenWaggleExtensionMountContext,
  OpenWaggleExtensionSdk,
  OpenWaggleExtensionSurfaceSdk,
  OpenWaggleFederatedModule,
} from './lib/extension-federated-module'
export {
  createExtensionMountContext,
  importFederatedModule,
  isFederatedModule,
} from './lib/extension-federated-module'
export { createExtensionModuleUrl } from './lib/extension-module-url'
export type {
  ExtensionRouteResolution,
  ResolvedExtensionRouteContribution,
} from './lib/extension-route-resolution'
export { resolveExtensionRouteContribution } from './lib/extension-route-resolution'
export type {
  ExtensionSidePanelResolution,
  ExtensionSidePanelTarget,
  ResolvedExtensionSidePanelContribution,
} from './lib/extension-side-panel-resolution'
export { resolveExtensionSidePanelContribution } from './lib/extension-side-panel-resolution'
export {
  type ExtensionSidePanelSurfaceEntry,
  extensionSidePanelSurfaces,
  openableExtensionSidePanelSurfaceIds,
} from './lib/extension-side-panel-surfaces'
