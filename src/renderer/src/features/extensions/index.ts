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
  type ExtensionInteractionView,
} from './components/ExtensionAgentLoopSurface'
export { ExtensionPanelIcon } from './components/ExtensionPanelIcon'
export { useExtensionSidePanelContributions } from './hooks/useExtensionSidePanelContributions'
export {
  agentLoopAuxiliarySurfacePayload,
  agentLoopInputKey,
} from './lib/extension-agent-loop-auxiliary-surfaces'
export { resolveExtensionAgentLoopContributionEntries } from './lib/extension-agent-loop-resolution'
export { surfaceLabel, surfaceTarget } from './lib/extension-agent-loop-surface-model'
export { invokeBoundExtension } from './lib/extension-contribution-invocation'
export type { ExtensionDialogTarget } from './lib/extension-dialog-resolution'
export type { ExtensionSidePanelTarget } from './lib/extension-side-panel-resolution'
export {
  type ExtensionSidePanelSurfaceEntry,
  extensionSidePanelSurfaces,
  openableExtensionSidePanelSurfaceIds,
} from './lib/extension-side-panel-surfaces'
