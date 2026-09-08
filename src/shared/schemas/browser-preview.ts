import { Schema } from '@shared/schema'
import type {
  BrowserPreviewBounds,
  BrowserPreviewOpenInput,
  BrowserPreviewShortcutBindings,
} from '@shared/types/browser-preview'
import { BROWSER_PREVIEW_LIMITS, BROWSER_PREVIEW_ZOOM_ACTIONS } from '@shared/types/browser-preview'
import { SHORTCUT_RULE_LIMITS } from '@shared/types/shortcuts'
import {
  browserPreviewAppearanceSchema,
  browserPreviewInitialControlsSchema,
  browserPreviewRecordingSaveInputSchema,
  browserPreviewViewportSchema,
} from './browser-preview-controls'
import { browserProfileIdSchema } from './browser-profile'

function isBrowserPreviewId(value: string) {
  return (
    (/^[A-Za-z0-9._:-]+$/.test(value) && value.length <= BROWSER_PREVIEW_LIMITS.ID_LENGTH) ||
    'Preview ID must use letters, numbers, dots, underscores, colons, or hyphens.'
  )
}

export function isBrowserPreviewUrl(value: string) {
  if (value !== value.trim() || value.length === 0) return false
  if (value.length > BROWSER_PREVIEW_LIMITS.URL_LENGTH) return false

  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    )
  } catch {
    return false
  }
}

export function normalizeBrowserPreviewUrl(value: string) {
  if (!isBrowserPreviewUrl(value)) {
    throw new Error('Browser preview URLs must be valid HTTP or HTTPS URLs without credentials.')
  }
  return new URL(value).href
}

export const browserPreviewIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(BROWSER_PREVIEW_LIMITS.ID_LENGTH),
  Schema.filter(isBrowserPreviewId),
)

export const browserPreviewOwnerKeySchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(BROWSER_PREVIEW_LIMITS.OWNER_KEY_LENGTH),
  Schema.filter(
    (value) =>
      (value === value.trim() && !/[\p{Cc}]/u.test(value)) ||
      'Browser preview owner keys must be trimmed and contain no control characters.',
  ),
)

export const browserPreviewUrlSchema = Schema.String.pipe(
  Schema.maxLength(BROWSER_PREVIEW_LIMITS.URL_LENGTH),
  Schema.filter(
    (value) =>
      isBrowserPreviewUrl(value) ||
      'Must be a valid HTTP or HTTPS URL without embedded credentials.',
  ),
)

const dipPositionSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(BROWSER_PREVIEW_LIMITS.MAX_DIP),
)

const dipSizeSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(BROWSER_PREVIEW_LIMITS.MAX_DIP),
)

export const browserPreviewBoundsSchema: Schema.Schema<BrowserPreviewBounds> = Schema.Struct({
  x: dipPositionSchema,
  y: dipPositionSchema,
  width: dipSizeSchema,
  height: dipSizeSchema,
  sourceViewport: Schema.optional(Schema.Struct({ width: dipSizeSchema, height: dipSizeSchema })),
}).pipe(
  Schema.filter(
    (bounds) =>
      (bounds.x + bounds.width <= BROWSER_PREVIEW_LIMITS.MAX_DIP &&
        bounds.y + bounds.height <= BROWSER_PREVIEW_LIMITS.MAX_DIP) ||
      `Bounds must fit within ${String(BROWSER_PREVIEW_LIMITS.MAX_DIP)} DIPs.`,
  ),
)

export const browserPreviewOpenInputSchema: Schema.Schema<BrowserPreviewOpenInput> = Schema.Struct({
  previewId: browserPreviewIdSchema,
  ownerKey: browserPreviewOwnerKeySchema,
  profileId: browserProfileIdSchema,
  url: browserPreviewUrlSchema,
  bounds: browserPreviewBoundsSchema,
  visible: Schema.Boolean,
  audioMuted: Schema.optional(Schema.Boolean),
  initialControls: Schema.optional(browserPreviewInitialControlsSchema),
})

export const browserPreviewIdAndAudioMutedSchema = Schema.Tuple(
  browserPreviewIdSchema,
  Schema.Boolean,
)

export const browserPreviewIdAndBoundsSchema = Schema.Tuple(
  browserPreviewIdSchema,
  Schema.NullOr(browserPreviewBoundsSchema),
)

export const browserPreviewReplacementInputSchema = Schema.Tuple(
  browserPreviewOpenInputSchema,
  browserPreviewIdSchema,
)

export const browserPreviewIdAndUrlSchema = Schema.Tuple(
  browserPreviewIdSchema,
  browserPreviewUrlSchema,
)

export const browserPreviewIdAndZoomActionSchema = Schema.Tuple(
  browserPreviewIdSchema,
  Schema.Literal(...BROWSER_PREVIEW_ZOOM_ACTIONS),
)

export const browserPreviewIdAndViewportSchema = Schema.Tuple(
  browserPreviewIdSchema,
  browserPreviewViewportSchema,
)

export const browserPreviewIdAndAppearanceSchema = Schema.Tuple(
  browserPreviewIdSchema,
  browserPreviewAppearanceSchema,
)

export const browserPreviewRecordingInputSchema = browserPreviewRecordingSaveInputSchema

export const browserPreviewArtifactPathSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(BROWSER_PREVIEW_LIMITS.MAX_DIP),
  Schema.filter(
    (value) =>
      (value === value.trim() && !/[\p{Cc}]/u.test(value)) ||
      'Browser preview artifact paths must be trimmed and contain no control characters.',
  ),
)

const browserPreviewShortcutBindingSchema = Schema.Struct({
  key: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(SHORTCUT_RULE_LIMITS.KEY_LENGTH),
    Schema.filter((key) => key.trim().length > 0 || 'Shortcut key cannot be blank.'),
  ),
  mod: Schema.optional(Schema.Boolean),
  ctrl: Schema.optional(Schema.Boolean),
  shift: Schema.optional(Schema.Boolean),
  alt: Schema.optional(Schema.Boolean),
  meta: Schema.optional(Schema.Boolean),
})

export const browserPreviewShortcutBindingsSchema: Schema.Schema<BrowserPreviewShortcutBindings> =
  Schema.Array(browserPreviewShortcutBindingSchema).pipe(
    Schema.maxItems(BROWSER_PREVIEW_LIMITS.SHORTCUT_BINDINGS),
  )
