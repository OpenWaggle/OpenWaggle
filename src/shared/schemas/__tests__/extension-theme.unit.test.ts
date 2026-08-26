import { createOpenWaggleExtensionTheme } from '@shared/extension-theme'
import { safeDecodeUnknown } from '@shared/schema'
import { extensionThemeSchema } from '@shared/schemas/extension-theme'
import { describe, expect, it } from 'vitest'

describe('extension theme schema', () => {
  it('preserves every ADR 0024 token group across the runtime boundary', () => {
    const theme = createOpenWaggleExtensionTheme()
    const result = safeDecodeUnknown(extensionThemeSchema, theme)

    expect(result.success).toBe(true)
    if (!result.success) {
      return
    }

    expect(result.data.tokens.color.dangerText).toBe('#f87171')
    expect(result.data.tokens.color.infoText).toBe('#60a5fa')
    expect(result.data.tokens.typography.typeScale.twoXl.fontSize).toBe('1.5rem')
    expect(result.data.tokens.spacing.unit).toBe('0.25rem')
    expect(result.data.tokens.radius.fourXl).toBe('2rem')
    expect(result.data.tokens.shadow.twoXl).toBe('0 25px 50px -12px rgb(0 0 0 / 0.25)')
    expect(result.data.tokens.focus).toEqual({ ring: 'transparent', shadow: 'none' })
  })
})
