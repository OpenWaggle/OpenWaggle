import type { OpenWaggleExtensionSurfaceContext } from '@shared/extension-context'

export interface ExtensionFrameRegisterInput {
  readonly frameId: string
  readonly bootstrapUrl: string
  readonly networkOrigins?: readonly string[]
}

export interface ExtensionFrameRegisterResult {
  readonly frameUrl: string
  readonly registrationId: string
}

export interface ExtensionFrameUnregisterInput {
  readonly frameId: string
  readonly registrationId: string
}

export type ExtensionFrameMountContext = OpenWaggleExtensionSurfaceContext

export interface ExtensionFrameConfig {
  readonly moduleUrl: string
  readonly context: ExtensionFrameMountContext
}
