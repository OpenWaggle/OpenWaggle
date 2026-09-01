import type {
  SyntaxAppearanceVariant,
  SyntaxThemeId,
  SyntaxThemePreviewPalette,
} from '@shared/types/syntax'

export const APPEARANCE_LABELS: Record<SyntaxAppearanceVariant, string> = {
  light: 'Light',
  dark: 'Dark',
  'high-contrast-light': 'High Contrast Light',
  'high-contrast-dark': 'High Contrast Dark',
}

export const APPEARANCE_DESCRIPTIONS: Record<SyntaxAppearanceVariant, string> = {
  light: 'For light app surfaces',
  dark: 'For dark app surfaces',
  'high-contrast-light': 'Bright accessible surfaces',
  'high-contrast-dark': 'Dark accessible surfaces',
}

export interface SyntaxThemeOption {
  readonly id: SyntaxThemeId
  readonly shikiTheme: string
  readonly label: string
  readonly variant: SyntaxAppearanceVariant
  readonly description: string
  readonly scope: 'bundled' | 'user' | 'project'
  readonly preview: SyntaxThemePreviewPalette
}
