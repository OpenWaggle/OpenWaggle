import { Schema } from '@shared/schema'
import { SESSION_TITLE_MODEL_AUTOMATIC, SESSION_TITLE_MODEL_OFF } from '@shared/session-title-model'
import { supportedModelIdSchema } from '@shared/types/brand'
import { settingsWireFields } from './settings-fields'

/** Runtime contract shared by IPC patches and persisted settings decoding. */
export const settingsUpdateSchema = Schema.partialWith(Schema.Struct(settingsWireFields), {
  exact: true,
})

/** Title model: Automatic, Off, or the model that generates Session titles. */
export const sessionTitleModelSettingSchema = Schema.Union(
  Schema.Literal(SESSION_TITLE_MODEL_AUTOMATIC),
  Schema.Literal(SESSION_TITLE_MODEL_OFF),
  supportedModelIdSchema,
)

/**
 * The Settings document the settings service resolves and the renderer reads: every persisted
 * setting, with model references branded, and which Pi runtime settings the user chose. The
 * single source of `Settings` in `@shared/types/settings`.
 */
export const settingsSchema = Schema.Struct({
  ...settingsWireFields,
  selectedModel: supportedModelIdSchema,
  favoriteModels: Schema.Array(supportedModelIdSchema),
  /** User-curated canonical Pi model refs ("provider/modelId") shown in the composer picker. */
  enabledModels: Schema.Array(supportedModelIdSchema),
  sessionTitleModel: sessionTitleModelSettingSchema,
  /**
   * Which of the Pi runtime settings the user chose in OpenWaggle. The others follow the user's
   * own Pi settings, read again for each Run, and fall back to OpenWaggle's defaults. Read-only.
   */
  piRuntimeSettingsChosen: Schema.Struct({
    codemodeEnabled: Schema.Boolean,
    cacheWarming: Schema.Boolean,
  }),
})
