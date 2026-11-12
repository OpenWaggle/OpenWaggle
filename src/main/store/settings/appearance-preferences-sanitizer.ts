import { Schema } from '@shared/schema'
import {
  appearanceMotionPreferenceSchema,
  appearanceTerminalPalettePreferencesSchema,
  appearanceTypographyPreferencesSchema,
} from '@shared/schemas/appearance-preferences'
import { lenientResolved, lenientWithFallback } from '@shared/schemas/lenient-exact'
import {
  type AppearancePreferences,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CODE_LINE_HEIGHT_MAX,
  CODE_LINE_HEIGHT_MIN,
  DEFAULT_APPEARANCE_PREFERENCES,
  DOCUMENT_FONT_SIZE_MAX,
  DOCUMENT_FONT_SIZE_MIN,
  DOCUMENT_LINE_HEIGHT_MAX,
  DOCUMENT_LINE_HEIGHT_MIN,
  FONT_FAMILY_MAX_LENGTH,
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  normalizeTerminalPaletteColor,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '@shared/types/appearance-preferences'
import { Option } from 'effect'

/**
 * Stored Appearance preferences, resolved field by field: a number out of range is clamped, a
 * font family is cleaned of control characters, and anything unreadable takes its default, so a
 * damaged value never costs the user the rest of their preferences.
 */

const FIRST_CONTROL_CHARACTER_LIMIT = 32
const DELETE_CONTROL_CHARACTER = 127
const CODE_LINE_HEIGHT_FONT_SIZE_GAP = 2

const DEFAULT_TYPOGRAPHY = DEFAULT_APPEARANCE_PREFERENCES.typography

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function boundedNumber(minimum: number, maximum: number, fallback: number) {
  return lenientResolved(Schema.Number, (raw) =>
    clamp(typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback, minimum, maximum),
  )
}

function fontFamily(fallback: string) {
  return lenientResolved(Schema.String, (raw) => {
    if (typeof raw !== 'string') return fallback
    const normalized = Array.from(raw, (character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint < FIRST_CONTROL_CHARACTER_LIMIT || codePoint === DELETE_CONTROL_CHARACTER
        ? ' '
        : character
    })
      .join('')
      .trim()
    return normalized.length > 0 && normalized.length <= FONT_FAMILY_MAX_LENGTH
      ? normalized
      : fallback
  })
}

function flag(fallback: boolean) {
  return lenientWithFallback(Schema.Boolean, () => fallback)
}

const storedTypographySchema = Schema.Struct({
  interfaceFontFamily: fontFamily(DEFAULT_TYPOGRAPHY.interfaceFontFamily),
  documentFontFamily: fontFamily(DEFAULT_TYPOGRAPHY.documentFontFamily),
  codeFontFamily: fontFamily(DEFAULT_TYPOGRAPHY.codeFontFamily),
  terminalFontFamily: fontFamily(DEFAULT_TYPOGRAPHY.terminalFontFamily),
  terminalUsesCodeFont: flag(DEFAULT_TYPOGRAPHY.terminalUsesCodeFont),
  interfaceScale: boundedNumber(
    INTERFACE_SCALE_MIN,
    INTERFACE_SCALE_MAX,
    DEFAULT_TYPOGRAPHY.interfaceScale,
  ),
  documentFontSize: boundedNumber(
    DOCUMENT_FONT_SIZE_MIN,
    DOCUMENT_FONT_SIZE_MAX,
    DEFAULT_TYPOGRAPHY.documentFontSize,
  ),
  documentLineHeight: boundedNumber(
    DOCUMENT_LINE_HEIGHT_MIN,
    DOCUMENT_LINE_HEIGHT_MAX,
    DEFAULT_TYPOGRAPHY.documentLineHeight,
  ),
  codeFontSize: boundedNumber(
    CODE_FONT_SIZE_MIN,
    CODE_FONT_SIZE_MAX,
    DEFAULT_TYPOGRAPHY.codeFontSize,
  ),
  codeLineHeight: boundedNumber(
    CODE_LINE_HEIGHT_MIN,
    CODE_LINE_HEIGHT_MAX,
    DEFAULT_TYPOGRAPHY.codeLineHeight,
  ),
  terminalFontSize: boundedNumber(
    TERMINAL_FONT_SIZE_MIN,
    TERMINAL_FONT_SIZE_MAX,
    DEFAULT_TYPOGRAPHY.terminalFontSize,
  ),
  codeLigatures: flag(DEFAULT_TYPOGRAPHY.codeLigatures),
})

const decodeStoredTypography = Schema.decodeUnknownOption(storedTypographySchema)

/** The code line height stays at least 2px above the code font size, as the strict schema requires. */
function resolveTypography(raw: unknown) {
  return Option.match(decodeStoredTypography(raw), {
    onNone: () => DEFAULT_TYPOGRAPHY,
    onSome: (typography) => ({
      ...typography,
      codeLineHeight: Math.max(
        typography.codeLineHeight,
        typography.codeFontSize + CODE_LINE_HEIGHT_FONT_SIZE_GAP,
      ),
    }),
  })
}

const paletteColor = lenientResolved(
  appearanceTerminalPalettePreferencesSchema.fields.background,
  normalizeTerminalPaletteColor,
)

const storedTerminalPaletteSchema = Schema.Struct({
  background: paletteColor,
  foreground: paletteColor,
  cursor: paletteColor,
  selection: paletteColor,
  scrollbar: paletteColor,
})

const decodeStoredTerminalPalette = Schema.decodeUnknownOption(storedTerminalPaletteSchema)

const decodeStoredAppearance = Schema.decodeUnknownOption(
  Schema.Struct({
    typography: lenientResolved(appearanceTypographyPreferencesSchema, resolveTypography),
    terminalPalette: lenientResolved(appearanceTerminalPalettePreferencesSchema, (raw) =>
      Option.getOrElse(
        decodeStoredTerminalPalette(raw),
        () => DEFAULT_APPEARANCE_PREFERENCES.terminalPalette,
      ),
    ),
    motion: lenientWithFallback(
      appearanceMotionPreferenceSchema,
      () => DEFAULT_APPEARANCE_PREFERENCES.motion,
    ),
  }),
)

export function resolveAppearancePreferences(value: unknown) {
  const preferences: AppearancePreferences = Option.getOrElse(
    decodeStoredAppearance(value),
    () => DEFAULT_APPEARANCE_PREFERENCES,
  )
  return preferences
}
