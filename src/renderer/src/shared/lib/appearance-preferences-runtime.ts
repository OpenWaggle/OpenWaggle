import { PERCENT_BASE } from '@shared/constants/math'
import {
  type AppearancePreferences,
  DEFAULT_APPEARANCE_PREFERENCES,
} from '@shared/types/appearance-preferences'
import { create } from 'zustand'

interface AppearancePreferencesRuntimeState {
  readonly preferences: AppearancePreferences
}

export const useAppearancePreferencesRuntimeStore = create<AppearancePreferencesRuntimeState>(
  () => ({ preferences: DEFAULT_APPEARANCE_PREFERENCES }),
)

function setPreferenceOverride(
  root: HTMLElement,
  property: string,
  value: string | number | boolean,
  defaultValue: string | number | boolean,
  serialize: (input: typeof value) => string = String,
) {
  if (value === defaultValue) {
    root.style.removeProperty(property)
    return
  }
  root.style.setProperty(property, serialize(value))
}

function applyAppearancePreferences(preferences: AppearancePreferences) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const typography = preferences.typography
  const terminalFontFamily = typography.terminalUsesCodeFont
    ? typography.codeFontFamily
    : typography.terminalFontFamily

  const defaults = DEFAULT_APPEARANCE_PREFERENCES.typography
  setPreferenceOverride(
    root,
    '--font-sans',
    typography.interfaceFontFamily,
    defaults.interfaceFontFamily,
  )
  setPreferenceOverride(
    root,
    '--font-document',
    typography.documentFontFamily,
    defaults.documentFontFamily,
  )
  setPreferenceOverride(root, '--font-mono', typography.codeFontFamily, defaults.codeFontFamily)
  const terminalUsesAppearanceDefault =
    typography.terminalUsesCodeFont === defaults.terminalUsesCodeFont &&
    typography.codeFontFamily === defaults.codeFontFamily
  if (terminalUsesAppearanceDefault) root.style.removeProperty('--font-terminal')
  else root.style.setProperty('--font-terminal', terminalFontFamily)
  setPreferenceOverride(
    root,
    '--font-document-size',
    typography.documentFontSize,
    defaults.documentFontSize,
    (value) => `${value}px`,
  )
  setPreferenceOverride(
    root,
    '--font-document-line-height',
    typography.documentLineHeight,
    defaults.documentLineHeight,
    (value) => String(Number(value) / PERCENT_BASE),
  )
  setPreferenceOverride(
    root,
    '--font-code-size',
    typography.codeFontSize,
    defaults.codeFontSize,
    (value) => `${value}px`,
  )
  setPreferenceOverride(
    root,
    '--font-code-line-height',
    typography.codeLineHeight,
    defaults.codeLineHeight,
    (value) => `${value}px`,
  )
  setPreferenceOverride(
    root,
    '--font-terminal-size',
    typography.terminalFontSize,
    defaults.terminalFontSize,
    (value) => `${value}px`,
  )
  setPreferenceOverride(
    root,
    '--font-code-ligatures',
    typography.codeLigatures,
    defaults.codeLigatures,
    (value) => (value ? 'normal' : 'none'),
  )
  root.style.fontSize =
    typography.interfaceScale === defaults.interfaceScale ? '' : `${typography.interfaceScale}%`

  if (preferences.motion === 'reduced') {
    root.dataset.motion = 'reduced'
  } else {
    delete root.dataset.motion
  }
}

export function setRuntimeAppearancePreferences(preferences: AppearancePreferences) {
  useAppearancePreferencesRuntimeStore.setState({ preferences })
  applyAppearancePreferences(preferences)
}
