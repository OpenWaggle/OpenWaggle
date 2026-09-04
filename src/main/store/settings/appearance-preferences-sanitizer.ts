import {
  APPEARANCE_MOTION_PREFERENCES,
  type AppearancePreferences,
  type AppearanceTypographyPreferences,
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
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '@shared/types/appearance-preferences'
import { includes } from '@shared/utils/validation'

const FIRST_CONTROL_CHARACTER_LIMIT = 32
const DELETE_CONTROL_CHARACTER = 127
const CODE_LINE_HEIGHT_FONT_SIZE_GAP = 2

function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedNumber(raw: unknown, minimum: number, maximum: number, fallback: number) {
  const candidate = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  return Math.min(maximum, Math.max(minimum, candidate))
}

function fontFamily(raw: unknown, fallback: string) {
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
}

function resolveAppearanceTypography(raw: unknown): AppearanceTypographyPreferences {
  const defaults = DEFAULT_APPEARANCE_PREFERENCES.typography
  if (!isObjectRecord(raw)) return defaults

  const codeFontSize = boundedNumber(
    raw.codeFontSize,
    CODE_FONT_SIZE_MIN,
    CODE_FONT_SIZE_MAX,
    defaults.codeFontSize,
  )
  const minimumCodeLineHeight = Math.max(
    CODE_LINE_HEIGHT_MIN,
    codeFontSize + CODE_LINE_HEIGHT_FONT_SIZE_GAP,
  )
  return {
    interfaceFontFamily: fontFamily(raw.interfaceFontFamily, defaults.interfaceFontFamily),
    documentFontFamily: fontFamily(raw.documentFontFamily, defaults.documentFontFamily),
    codeFontFamily: fontFamily(raw.codeFontFamily, defaults.codeFontFamily),
    terminalFontFamily: fontFamily(raw.terminalFontFamily, defaults.terminalFontFamily),
    terminalUsesCodeFont:
      typeof raw.terminalUsesCodeFont === 'boolean'
        ? raw.terminalUsesCodeFont
        : defaults.terminalUsesCodeFont,
    interfaceScale: boundedNumber(
      raw.interfaceScale,
      INTERFACE_SCALE_MIN,
      INTERFACE_SCALE_MAX,
      defaults.interfaceScale,
    ),
    documentFontSize: boundedNumber(
      raw.documentFontSize,
      DOCUMENT_FONT_SIZE_MIN,
      DOCUMENT_FONT_SIZE_MAX,
      defaults.documentFontSize,
    ),
    documentLineHeight: boundedNumber(
      raw.documentLineHeight,
      DOCUMENT_LINE_HEIGHT_MIN,
      DOCUMENT_LINE_HEIGHT_MAX,
      defaults.documentLineHeight,
    ),
    codeFontSize,
    codeLineHeight: boundedNumber(
      raw.codeLineHeight,
      minimumCodeLineHeight,
      CODE_LINE_HEIGHT_MAX,
      defaults.codeLineHeight,
    ),
    terminalFontSize: boundedNumber(
      raw.terminalFontSize,
      TERMINAL_FONT_SIZE_MIN,
      TERMINAL_FONT_SIZE_MAX,
      defaults.terminalFontSize,
    ),
    codeLigatures:
      typeof raw.codeLigatures === 'boolean' ? raw.codeLigatures : defaults.codeLigatures,
  }
}

export function resolveAppearancePreferences(raw: unknown): AppearancePreferences {
  if (!isObjectRecord(raw)) return DEFAULT_APPEARANCE_PREFERENCES
  const motion =
    typeof raw.motion === 'string' && includes(APPEARANCE_MOTION_PREFERENCES, raw.motion)
      ? raw.motion
      : DEFAULT_APPEARANCE_PREFERENCES.motion

  return {
    typography: resolveAppearanceTypography(raw.typography),
    motion,
  }
}
