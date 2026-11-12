import type {
  OpenWaggleExtensionSdk,
  OpenWaggleExtensionSharedModules,
  OpenWaggleExtensionSurfaceContext,
} from '@shared/extension-context'

export type { OpenWaggleExtensionSdk }

export interface OpenWaggleExtensionMountContext extends OpenWaggleExtensionSurfaceContext {
  readonly root: HTMLElement
  readonly sdk: OpenWaggleExtensionSdk
  readonly modules: OpenWaggleExtensionSharedModules
}

export type ExtensionFederatedModuleCleanup = () => void
export type ExtensionFederatedModuleMountResult = undefined | ExtensionFederatedModuleCleanup

export interface OpenWaggleFederatedModule {
  readonly mount: (
    context: OpenWaggleExtensionMountContext,
  ) => ExtensionFederatedModuleMountResult | Promise<ExtensionFederatedModuleMountResult>
}

function moduleMountExport(value: object) {
  const result: unknown = Object.getOwnPropertyDescriptor(value, 'mount')?.value
  return result
}

export function isFederatedModule(value: unknown): value is OpenWaggleFederatedModule {
  return (
    typeof value === 'object' && value !== null && typeof moduleMountExport(value) === 'function'
  )
}
