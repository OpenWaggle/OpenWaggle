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

export const TERMINAL_PALETTE_ROLES = [
  'background',
  'foreground',
  'cursor',
  'selection',
  'scrollbar',
] as const
export type TerminalPaletteRole = (typeof TERMINAL_PALETTE_ROLES)[number]

const TERMINAL_PALETTE_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu
const SHORT_TERMINAL_PALETTE_COLOR_LENGTH = 5

/** User-authored terminal colours. Null keeps the active theme in control of that role. */
export interface AppearanceTerminalPalettePreferences {
  readonly background: string | null
  readonly foreground: string | null
  readonly cursor: string | null
  readonly selection: string | null
  readonly scrollbar: string | null
}

/** Accepts CSS hex colours and canonicalizes short/upper-case forms for persistence. */
export function normalizeTerminalPaletteColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!TERMINAL_PALETTE_COLOR_PATTERN.test(normalized)) return null
  if (normalized.length > SHORT_TERMINAL_PALETTE_COLOR_LENGTH) return normalized
  return `#${Array.from(normalized.slice(1), (digit) => `${digit}${digit}`).join('')}`
}

export function isTerminalPaletteColor(value: unknown): value is string {
  return normalizeTerminalPaletteColor(value) !== null
}

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
  readonly terminalPalette: AppearanceTerminalPalettePreferences
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

export const DEFAULT_APPEARANCE_TERMINAL_PALETTE: AppearanceTerminalPalettePreferences = {
  background: null,
  foreground: null,
  cursor: null,
  selection: null,
  scrollbar: null,
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  typography: DEFAULT_APPEARANCE_TYPOGRAPHY,
  terminalPalette: DEFAULT_APPEARANCE_TERMINAL_PALETTE,
  motion: 'system',
}
