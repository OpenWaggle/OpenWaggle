import { Schema } from '@shared/schema'
import type { ExtensionFrameMountContext } from '@shared/types/extension-frame'
import { isNetworkOrigin } from './extension-network-origin'
import { extensionThemeSchema } from './extension-theme'
import { jsonValueSchema } from './validation'

const extensionNetworkOriginSchema = Schema.String.pipe(Schema.filter(isNetworkOrigin))

/*
 * The extension frame requests and mount config; each schema is the one source of its type in
 * `@shared/types/extension-frame`. The mount context keeps its annotation: its type is the
 * extension-facing OpenWaggleExtensionSurfaceContext, declared in `@shared/extension-context`.
 */
export const extensionFrameRegisterInputSchema = Schema.Struct({
  frameId: Schema.String,
  bootstrapUrl: Schema.String,
  networkOrigins: Schema.optionalWith(Schema.Array(extensionNetworkOriginSchema), { exact: true }),
})

export const extensionFrameUnregisterInputSchema = Schema.Struct({
  frameId: Schema.String,
  registrationId: Schema.String,
})

export const extensionFrameMountContextSchema: Schema.Schema<ExtensionFrameMountContext> =
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
      // Exact, as OpenWaggleExtensionSurfaceContext declares it: a JSON payload or no key at all.
      payload: Schema.optionalWith(jsonValueSchema, { exact: true }),
    }),
    packagePath: Schema.String,
    projectPaths: Schema.Array(Schema.String),
    // A Struct drops undeclared keys, so a surface resolved for a Session keeps its id only here.
    sessionId: Schema.optionalWith(Schema.String, { exact: true }),
    theme: extensionThemeSchema,
  })

export const extensionFrameConfigSchema = Schema.Struct({
  moduleUrl: Schema.String,
  context: extensionFrameMountContextSchema,
})
