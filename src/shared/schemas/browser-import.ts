import { Schema } from '@shared/schema'
import { BROWSER_IMPORT_LIMITS, BROWSER_IMPORT_SOURCE_IDS } from '@shared/types/browser-import'
import { browserProfileIdSchema } from './browser-profile'

export const browserImportSourceIdSchema = Schema.Literal(...BROWSER_IMPORT_SOURCE_IDS)

const browserImportProfileDirectorySchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(BROWSER_IMPORT_LIMITS.STRING_LENGTH),
  Schema.filter(
    (value) =>
      (value === value.trim() && !value.includes('\u0000')) ||
      'Browser source profile directories must be trimmed and contain no NUL bytes.',
  ),
)

/** The one source of the browser import request types in `@shared/types/browser-import`. */
export const browserImportInputSchema = Schema.Struct({
  sourceId: browserImportSourceIdSchema,
  sourceProfileDirectory: browserImportProfileDirectorySchema,
  targetProfileId: browserProfileIdSchema,
})

export const browserImportTargetSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('new'),
    profileId: browserProfileIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('existing'),
    profileId: browserProfileIdSchema,
  }),
)

/**
 * Guided import request. The existing direct import request stays available for
 * callers that already manage a persistent destination profile.
 */
export const guidedBrowserImportInputSchema = Schema.Struct({
  sourceId: browserImportSourceIdSchema,
  sourceProfileDirectory: browserImportProfileDirectorySchema,
  target: browserImportTargetSchema,
})
