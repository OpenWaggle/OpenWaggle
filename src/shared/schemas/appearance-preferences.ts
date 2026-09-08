import { Schema } from '@shared/schema'
import {
  APPEARANCE_MOTION_PREFERENCES,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CODE_LINE_HEIGHT_MAX,
  CODE_LINE_HEIGHT_MIN,
  DOCUMENT_FONT_SIZE_MAX,
  DOCUMENT_FONT_SIZE_MIN,
  DOCUMENT_LINE_HEIGHT_MAX,
  DOCUMENT_LINE_HEIGHT_MIN,
  FONT_FAMILY_MAX_LENGTH,
  INTERFACE_SCALE_MAX,
  INTERFACE_SCALE_MIN,
  isTerminalPaletteColor,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from '@shared/types/appearance-preferences'

const FIRST_CONTROL_CHARACTER_LIMIT = 32
const DELETE_CONTROL_CHARACTER = 127
const CODE_LINE_HEIGHT_FONT_SIZE_GAP = 2

const boundedNumber = (minimum: number, maximum: number) =>
  Schema.Number.pipe(
    Schema.finite(),
    Schema.greaterThanOrEqualTo(minimum),
    Schema.lessThanOrEqualTo(maximum),
  )

const fontFamilySchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(FONT_FAMILY_MAX_LENGTH),
  Schema.filter(
    (family) =>
      (family === family.trim() &&
        !Array.from(family).some((character) => {
          const codePoint = character.codePointAt(0) ?? 0
          return codePoint < FIRST_CONTROL_CHARACTER_LIMIT || codePoint === DELETE_CONTROL_CHARACTER
        })) ||
      'Font families must be trimmed and contain no control characters.',
  ),
)

const terminalPaletteColorSchema = Schema.NullOr(
  Schema.String.pipe(
    Schema.filter(isTerminalPaletteColor, {
      message: () => 'Expected a hex colour (#RGB, #RGBA, #RRGGBB, or #RRGGBBAA).',
    }),
  ),
)

const typographySchema = Schema.Struct({
  interfaceFontFamily: fontFamilySchema,
  documentFontFamily: fontFamilySchema,
  codeFontFamily: fontFamilySchema,
  terminalFontFamily: fontFamilySchema,
  terminalUsesCodeFont: Schema.Boolean,
  interfaceScale: boundedNumber(INTERFACE_SCALE_MIN, INTERFACE_SCALE_MAX),
  documentFontSize: boundedNumber(DOCUMENT_FONT_SIZE_MIN, DOCUMENT_FONT_SIZE_MAX),
  documentLineHeight: boundedNumber(DOCUMENT_LINE_HEIGHT_MIN, DOCUMENT_LINE_HEIGHT_MAX),
  codeFontSize: boundedNumber(CODE_FONT_SIZE_MIN, CODE_FONT_SIZE_MAX),
  codeLineHeight: boundedNumber(CODE_LINE_HEIGHT_MIN, CODE_LINE_HEIGHT_MAX),
  terminalFontSize: boundedNumber(TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_MAX),
  codeLigatures: Schema.Boolean,
}).pipe(
  Schema.filter(
    ({ codeFontSize, codeLineHeight }) =>
      codeLineHeight >= codeFontSize + CODE_LINE_HEIGHT_FONT_SIZE_GAP ||
      'Code line height must remain at least 2px larger than the code font size.',
  ),
)

export const appearancePreferencesSchema = Schema.Struct({
  typography: typographySchema,
  terminalPalette: Schema.Struct({
    background: terminalPaletteColorSchema,
    foreground: terminalPaletteColorSchema,
    cursor: terminalPaletteColorSchema,
    selection: terminalPaletteColorSchema,
    scrollbar: terminalPaletteColorSchema,
  }),
  motion: Schema.Literal(...APPEARANCE_MOTION_PREFERENCES),
})
