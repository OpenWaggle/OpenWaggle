import { Schema } from '@shared/schema'
import type {
  ExtensionFrameConfig,
  ExtensionFrameRegisterInput,
  ExtensionFrameUnregisterInput,
} from '@shared/types/extension-frame'
import { isNetworkOrigin } from './extension-network-origin'
import { extensionThemeSchema } from './extension-theme'
import { jsonValueSchema } from './validation'

const extensionNetworkOriginSchema = Schema.String.pipe(Schema.filter(isNetworkOrigin))

export const extensionFrameRegisterInputSchema: Schema.Schema<ExtensionFrameRegisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    bootstrapUrl: Schema.String,
    networkOrigins: Schema.optional(Schema.Array(extensionNetworkOriginSchema)),
  })

export const extensionFrameUnregisterInputSchema: Schema.Schema<ExtensionFrameUnregisterInput> =
  Schema.Struct({
    frameId: Schema.String,
    registrationId: Schema.String,
  })

export const extensionFrameMountContextSchema: Schema.Schema<ExtensionFrameConfig['context']> =
  Schema.Struct({
    extension: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      version: Schema.String,
    }),
    contribution: Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      family: Schema.String,
    }),
    surface: Schema.Struct({
      family: Schema.String,
      execution: Schema.String,
      payload: Schema.optional(jsonValueSchema),
    }),
    packagePath: Schema.String,
    projectPaths: Schema.Array(Schema.String),
    theme: extensionThemeSchema,
  })

export const extensionFrameConfigSchema: Schema.Schema<ExtensionFrameConfig> = Schema.Struct({
  moduleUrl: Schema.String,
  context: extensionFrameMountContextSchema,
})
