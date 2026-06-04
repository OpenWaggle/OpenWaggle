export { ExtensionFederatedModuleHost } from './components/ExtensionFederatedModuleHost'
export { ExtensionRouteSurface } from './components/ExtensionRouteSurface'
export { ExtensionRouteView } from './components/ExtensionRouteView'
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
