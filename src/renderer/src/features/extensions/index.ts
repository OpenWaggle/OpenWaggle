export { ExtensionFederatedModuleHost } from './components/ExtensionFederatedModuleHost'
export { ExtensionRouteSurface } from './components/ExtensionRouteSurface'
export { ExtensionRouteView } from './components/ExtensionRouteView'
export {
  ExtensionSidePanelSurface,
  ExtensionSidePanelSurfaceContent,
} from './components/ExtensionSidePanelSurface'
export { useExtensionSidePanelContributions } from './hooks/useExtensionSidePanelContributions'
export { refreshPreferencesAfterExtensionInvoke } from './lib/extension-broker-preferences'
export type {
  ExtensionFederatedModuleLoader,
  OpenWaggleExtensionMountContext,
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
