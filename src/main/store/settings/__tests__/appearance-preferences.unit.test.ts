import {
  CODE_FONT_SIZE_MAX,
  DEFAULT_APPEARANCE_PREFERENCES,
  INTERFACE_SCALE_MIN,
} from '@shared/types/appearance-preferences'
import { describe, expect, it } from 'vitest'
import { resolveAppearancePreferences } from '../appearance-preferences-sanitizer'

describe('appearance preference sanitization', () => {
  it('merges missing fields with standards-friendly defaults', () => {
    expect(
      resolveAppearancePreferences({
        typography: { codeFontFamily: 'JetBrains Mono, monospace' },
        motion: 'reduced',
      }),
    ).toEqual({
      motion: 'reduced',
      typography: {
        ...DEFAULT_APPEARANCE_PREFERENCES.typography,
        codeFontFamily: 'JetBrains Mono, monospace',
      },
    })
  })

  it('bounds numeric settings and rejects control-only font names', () => {
    const resolved = resolveAppearancePreferences({
      typography: {
        interfaceFontFamily: '\u0000\u0007',
        interfaceScale: 20,
        codeFontSize: 200,
      },
      motion: 'surprise',
    })

    expect(resolved.typography.interfaceFontFamily).toBe(
      DEFAULT_APPEARANCE_PREFERENCES.typography.interfaceFontFamily,
    )
    expect(resolved.typography.interfaceScale).toBe(INTERFACE_SCALE_MIN)
    expect(resolved.typography.codeFontSize).toBe(CODE_FONT_SIZE_MAX)
    expect(resolved.typography.codeLineHeight).toBe(CODE_FONT_SIZE_MAX + 2)
    expect(resolved.motion).toBe('system')
  })
})
