export const APPEARANCE_MOTION_PREFERENCES = ['system', 'reduced'] as const
export type AppearanceMotionPreference = (typeof APPEARANCE_MOTION_PREFERENCES)[number]

export const INTERFACE_SCALE_MIN = 85
export const INTERFACE_SCALE_MAX = 125
export const DOCUMENT_FONT_SIZE_MIN = 12
export const DOCUMENT_FONT_SIZE_MAX = 22
export const DOCUMENT_LINE_HEIGHT_MIN = 120
export const DOCUMENT_LINE_HEIGHT_MAX = 200
export const CODE_FONT_SIZE_MIN = 10
export const CODE_FONT_SIZE_MAX = 24
export const CODE_LINE_HEIGHT_MIN = 14
export const CODE_LINE_HEIGHT_MAX = 36
export const TERMINAL_FONT_SIZE_MIN = 10
export const TERMINAL_FONT_SIZE_MAX = 24
export const FONT_FAMILY_MAX_LENGTH = 240

export const DEFAULT_INTERFACE_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif'
export const DEFAULT_DOCUMENT_FONT_FAMILY = DEFAULT_INTERFACE_FONT_FAMILY
export const DEFAULT_CODE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

export interface AppearanceTypographyPreferences {
  readonly interfaceFontFamily: string
  readonly documentFontFamily: string
  readonly codeFontFamily: string
  readonly terminalFontFamily: string
  readonly terminalUsesCodeFont: boolean
  readonly interfaceScale: number
  readonly documentFontSize: number
  /** Percentage, so 160 means a 1.6 line-height. */
  readonly documentLineHeight: number
  readonly codeFontSize: number
  readonly codeLineHeight: number
  readonly terminalFontSize: number
  readonly codeLigatures: boolean
}

export interface AppearancePreferences {
  readonly typography: AppearanceTypographyPreferences
  readonly motion: AppearanceMotionPreference
}

export const DEFAULT_APPEARANCE_TYPOGRAPHY: AppearanceTypographyPreferences = {
  interfaceFontFamily: DEFAULT_INTERFACE_FONT_FAMILY,
  documentFontFamily: DEFAULT_DOCUMENT_FONT_FAMILY,
  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
  terminalFontFamily: DEFAULT_CODE_FONT_FAMILY,
  terminalUsesCodeFont: true,
  interfaceScale: 100,
  documentFontSize: 14,
  documentLineHeight: 150,
  codeFontSize: 12,
  codeLineHeight: 20,
  terminalFontSize: 14,
  codeLigatures: false,
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  typography: DEFAULT_APPEARANCE_TYPOGRAPHY,
  motion: 'system',
}
