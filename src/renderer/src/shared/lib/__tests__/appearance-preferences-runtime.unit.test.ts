// @vitest-environment jsdom

import { DEFAULT_APPEARANCE_PREFERENCES } from '@shared/types/appearance-preferences'
import { afterEach, describe, expect, it } from 'vitest'
import { testHexColor } from '@/test-utils/test-color'
import {
  APPEARANCE_PREFERENCES_CACHE_KEY,
  restoreCachedAppearancePreferences,
  setRuntimeAppearancePreferences,
  useAppearancePreferencesRuntimeStore,
} from '../appearance-preferences-runtime'

describe('appearance preferences runtime', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.motion
    localStorage.clear()
  })

  it('opens the next window in the last applied appearance, before Settings load', () => {
    const preferences = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      motion: 'reduced' as const,
      typography: { ...DEFAULT_APPEARANCE_PREFERENCES.typography, interfaceScale: 115 },
    }
    setRuntimeAppearancePreferences(preferences)
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.motion
    useAppearancePreferencesRuntimeStore.setState({ preferences: DEFAULT_APPEARANCE_PREFERENCES })

    expect(restoreCachedAppearancePreferences()).toBe(true)

    expect(document.documentElement.style.fontSize).toBe('115%')
    expect(document.documentElement.dataset.motion).toBe('reduced')
    expect(useAppearancePreferencesRuntimeStore.getState().preferences).toEqual(preferences)
  })

  it('drops a damaged appearance cache instead of applying it', () => {
    localStorage.setItem(APPEARANCE_PREFERENCES_CACHE_KEY, '{"typography":{"interfaceScale":9000}}')

    expect(restoreCachedAppearancePreferences()).toBe(false)

    expect(localStorage.getItem(APPEARANCE_PREFERENCES_CACHE_KEY)).toBeNull()
    expect(document.documentElement.style.fontSize).toBe('')
  })

  it('starts in the default appearance when nothing is cached', () => {
    expect(restoreCachedAppearancePreferences()).toBe(false)
  })

  it('applies typography through root variables without rebuilding the renderer', () => {
    setRuntimeAppearancePreferences({
      motion: 'reduced',
      terminalPalette: DEFAULT_APPEARANCE_PREFERENCES.terminalPalette,
      typography: {
        ...DEFAULT_APPEARANCE_PREFERENCES.typography,
        interfaceFontFamily: 'Inter, sans-serif',
        documentFontFamily: 'Georgia, serif',
        codeFontFamily: 'JetBrains Mono, monospace',
        interfaceScale: 110,
        documentFontSize: 16,
        codeFontSize: 14,
        codeLigatures: true,
      },
    })

    const root = document.documentElement
    expect(root.style.getPropertyValue('--font-sans')).toBe('Inter, sans-serif')
    expect(root.style.getPropertyValue('--font-document')).toBe('Georgia, serif')
    expect(root.style.getPropertyValue('--font-mono')).toBe('JetBrains Mono, monospace')
    expect(root.style.getPropertyValue('--font-code-size')).toBe('14px')
    expect(root.style.getPropertyValue('--font-code-ligatures')).toBe('normal')
    expect(root.style.fontSize).toBe('110%')
    expect(root.dataset.motion).toBe('reduced')
  })

  it('lets an appearance provide typography when preferences are reset to defaults', () => {
    setRuntimeAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      typography: {
        ...DEFAULT_APPEARANCE_PREFERENCES.typography,
        interfaceFontFamily: 'Inter, sans-serif',
        codeFontFamily: 'JetBrains Mono, monospace',
      },
    })

    setRuntimeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES)

    const root = document.documentElement
    expect(root.style.getPropertyValue('--font-sans')).toBe('')
    expect(root.style.getPropertyValue('--font-mono')).toBe('')
    expect(root.style.getPropertyValue('--font-terminal')).toBe('')
    expect(root.style.fontSize).toBe('')
  })

  it('applies terminal overrides and removes them when reset to theme', () => {
    const background = testHexColor('111111')
    const selection = testHexColor('33669988')
    setRuntimeAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      terminalPalette: {
        ...DEFAULT_APPEARANCE_PREFERENCES.terminalPalette,
        background,
        selection,
      },
    })

    const root = document.documentElement
    expect(root.style.getPropertyValue('--terminal-background-override')).toBe(background)
    expect(root.style.getPropertyValue('--terminal-selection-override')).toBe(selection)

    setRuntimeAppearancePreferences(DEFAULT_APPEARANCE_PREFERENCES)

    expect(root.style.getPropertyValue('--terminal-background-override')).toBe('')
    expect(root.style.getPropertyValue('--terminal-selection-override')).toBe('')
  })
})
