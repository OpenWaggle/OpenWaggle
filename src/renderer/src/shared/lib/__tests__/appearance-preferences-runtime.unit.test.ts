// @vitest-environment jsdom

import { DEFAULT_APPEARANCE_PREFERENCES } from '@shared/types/appearance-preferences'
import { afterEach, describe, expect, it } from 'vitest'
import { setRuntimeAppearancePreferences } from '../appearance-preferences-runtime'

describe('appearance preferences runtime', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.motion
  })

  it('applies typography through root variables without rebuilding the renderer', () => {
    setRuntimeAppearancePreferences({
      motion: 'reduced',
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
})
