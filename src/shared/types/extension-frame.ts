import type { OpenWaggleExtensionSurfaceContext } from '@shared/extension-context'
import type { SchemaType } from '@shared/schema'
import type {
  extensionFrameConfigSchema,
  extensionFrameRegisterInputSchema,
  extensionFrameUnregisterInputSchema,
} from '@shared/schemas/extension-frame'

export type ExtensionFrameRegisterInput = SchemaType<typeof extensionFrameRegisterInputSchema>

export interface ExtensionFrameRegisterResult {
  readonly frameUrl: string
  readonly registrationId: string
}

export type ExtensionFrameUnregisterInput = SchemaType<typeof extensionFrameUnregisterInputSchema>

export type ExtensionFrameMountContext = OpenWaggleExtensionSurfaceContext

export type ExtensionFrameConfig = SchemaType<typeof extensionFrameConfigSchema>
