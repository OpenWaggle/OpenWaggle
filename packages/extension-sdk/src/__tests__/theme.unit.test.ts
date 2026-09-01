import { fromAny } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import {
  createOpenWaggleExtensionTheme,
  extensionThemeCssVariableEntries,
  isOpenWaggleExtensionTheme,
} from '../theme.js'
import {
  DEFAULT_EXTENSION_THEME_TOKENS,
  EXTENSION_THEME_COLOR_KEYS,
  EXTENSION_THEME_FOCUS_KEYS,
  EXTENSION_THEME_RADIUS_KEYS,
  EXTENSION_THEME_SHADOW_KEYS,
  EXTENSION_THEME_SPACING_KEYS,
  EXTENSION_THEME_TYPE_SCALE_KEYS,
  OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES,
  SOURCE_EXTENSION_THEME_CSS_VARIABLES,
} from '../theme-data.js'
import { createOpenWaggleExtensionUiStylesheet } from '../ui-stylesheet.js'

const CONTRACT_ENTRY_COUNT = 55

function distinctResolver() {
  const resolved = new Map<string, string>()

  return {
    resolver(cssVariable: string) {
      const value = `resolved-${cssVariable}`
      resolved.set(cssVariable, value)
      return value
    },
    resolved,
  }
}

function collectSourceCssVariableNames(): string[] {
  const variables: string[] = []
  const source = SOURCE_EXTENSION_THEME_CSS_VARIABLES
  for (const role of Object.values(source.color)) variables.push(role)
  variables.push(source.typography.sansFamily, source.typography.monoFamily)
  for (const entry of Object.values(source.typography.typeScale)) {
    variables.push(entry.fontSize, entry.lineHeight)
  }
  variables.push(source.spacing.unit)
  for (const role of Object.values(source.radius)) variables.push(role)
  for (const role of Object.values(source.shadow)) variables.push(role)
  for (const role of Object.values(source.focus)) variables.push(role)
  return variables
}

describe('createOpenWaggleExtensionTheme', () => {
  it('supports the four standard colour-scheme variants', () => {
    const theme = createOpenWaggleExtensionTheme()
    expect(theme.colorScheme).toBe('dark')

    for (const colorScheme of [
      'light',
      'dark',
      'high-contrast-light',
      'high-contrast-dark',
    ] as const) {
      expect(isOpenWaggleExtensionTheme({ ...theme, colorScheme })).toBe(true)
      expect(createOpenWaggleExtensionTheme({ colorScheme }).colorScheme).toBe(colorScheme)
    }
    expect(
      isOpenWaggleExtensionTheme(
        fromAny<unknown, { colorScheme: 'sepia' }>({ ...theme, colorScheme: 'sepia' }),
      ),
    ).toBe(false)
  })

  it('maps the exact ADR 0024 contract to host variables', () => {
    expect(SOURCE_EXTENSION_THEME_CSS_VARIABLES).toEqual({
      color: {
        background: '--color-bg',
        surface: '--color-bg-secondary',
        surfaceRaised: '--color-bg-tertiary',
        surfaceHover: '--color-bg-hover',
        surfaceActive: '--color-bg-active',
        border: '--color-border',
        borderStrong: '--color-border-light',
        text: '--color-text-primary',
        textSubtle: '--color-text-secondary',
        textMuted: '--color-text-tertiary',
        textDim: '--color-text-muted',
        accent: '--color-accent',
        accentDim: '--color-accent-dim',
        success: '--color-success',
        danger: '--color-error',
        dangerText: '--color-error-text',
        warning: '--color-warning',
        info: '--color-info',
        infoText: '--color-info-text',
        review: '--color-review',
        plan: '--color-plan',
        progress: '--color-progress',
        neutral: '--color-neutral',
      },
      typography: {
        sansFamily: '--font-sans',
        monoFamily: '--font-mono',
        typeScale: {
          xs: { fontSize: '--text-xs', lineHeight: '--text-xs--line-height' },
          sm: { fontSize: '--text-sm', lineHeight: '--text-sm--line-height' },
          base: { fontSize: '--text-base', lineHeight: '--text-base--line-height' },
          lg: { fontSize: '--text-lg', lineHeight: '--text-lg--line-height' },
          xl: { fontSize: '--text-xl', lineHeight: '--text-xl--line-height' },
          twoXl: { fontSize: '--text-2xl', lineHeight: '--text-2xl--line-height' },
        },
      },
      spacing: { unit: '--spacing' },
      radius: {
        xs: '--radius-xs',
        sm: '--radius-sm',
        md: '--radius-md',
        lg: '--radius-lg',
        xl: '--radius-xl',
        twoXl: '--radius-2xl',
        threeXl: '--radius-3xl',
        fourXl: '--radius-4xl',
      },
      shadow: {
        twoXs: '--shadow-2xs',
        xs: '--shadow-xs',
        sm: '--shadow-sm',
        md: '--shadow-md',
        lg: '--shadow-lg',
        xl: '--shadow-xl',
        twoXl: '--shadow-2xl',
      },
      focus: { ring: '--focus-ring', shadow: '--focus-shadow' },
    })
  })

  it('resolves all 55 contract entries without falling back', () => {
    const { resolver, resolved } = distinctResolver()
    const theme = createOpenWaggleExtensionTheme({ resolveCssVariable: resolver })
    const entries = extensionThemeCssVariableEntries(theme)
    const sourceNames = new Set(collectSourceCssVariableNames())
    const resolvedPrefix = 'resolved-'

    expect(entries).toHaveLength(CONTRACT_ENTRY_COUNT)
    expect(sourceNames.size).toBe(CONTRACT_ENTRY_COUNT)
    for (const entry of entries) {
      expect(entry.value.startsWith(resolvedPrefix)).toBe(true)
      expect(sourceNames.has(entry.value.slice(resolvedPrefix.length)), `entry ${entry.name}`).toBe(
        true,
      )
    }
    for (const sourceName of sourceNames) {
      expect(resolved.has(sourceName), `source ${sourceName}`).toBe(true)
    }
  })

  it('uses Tailwind 4.3.3 defaults and contrast-safe colour fallbacks', () => {
    const theme = createOpenWaggleExtensionTheme()

    expect(theme.tokens.color).toEqual(DEFAULT_EXTENSION_THEME_TOKENS.color)
    expect(theme.tokens.color.dangerText).toBe('#f87171')
    expect(theme.tokens.color.infoText).toBe('#60a5fa')
    expect(theme.tokens.typography.typeScale).toEqual({
      xs: { fontSize: '0.75rem', lineHeight: 'calc(1 / 0.75)' },
      sm: { fontSize: '0.875rem', lineHeight: 'calc(1.25 / 0.875)' },
      base: { fontSize: '1rem', lineHeight: 'calc(1.5 / 1)' },
      lg: { fontSize: '1.125rem', lineHeight: 'calc(1.75 / 1.125)' },
      xl: { fontSize: '1.25rem', lineHeight: 'calc(1.75 / 1.25)' },
      twoXl: { fontSize: '1.5rem', lineHeight: 'calc(2 / 1.5)' },
    })
    expect(theme.tokens.spacing).toEqual({ unit: '0.25rem' })
    expect(theme.tokens.radius).toEqual({
      xs: '0.125rem',
      sm: '0.25rem',
      md: '0.375rem',
      lg: '0.5rem',
      xl: '0.75rem',
      twoXl: '1rem',
      threeXl: '1.5rem',
      fourXl: '2rem',
    })
    expect(theme.tokens.shadow).toEqual(DEFAULT_EXTENSION_THEME_TOKENS.shadow)
    expect(theme.tokens.focus).toEqual({ ring: 'transparent', shadow: 'none' })
  })

  it('emits exactly the standard projected variable set', () => {
    const entries = extensionThemeCssVariableEntries(createOpenWaggleExtensionTheme())
    const names = entries.map((entry) => entry.name)

    expect(names).toHaveLength(CONTRACT_ENTRY_COUNT)
    expect(new Set(names).size).toBe(CONTRACT_ENTRY_COUNT)
    expect(names).toContain('--ow-color-danger-text')
    expect(names).toContain('--ow-color-info-text')
    expect(names).toContain('--ow-text-xs')
    expect(names).toContain('--ow-text-2xl--line-height')
    expect(names).toContain('--ow-spacing')
    expect(names).toContain('--ow-radius-4xl')
    expect(names).toContain('--ow-shadow-2xs')
    expect(names).toContain('--ow-shadow-2xl')
    expect(names).not.toContain('--ow-control-md')
    expect(names).not.toContain('--ow-elevation-card')
  })

  it('keeps the key lists aligned with the closed contract', () => {
    expect(EXTENSION_THEME_COLOR_KEYS).toHaveLength(23)
    expect(EXTENSION_THEME_TYPE_SCALE_KEYS).toEqual(['xs', 'sm', 'base', 'lg', 'xl', 'twoXl'])
    expect(EXTENSION_THEME_SPACING_KEYS).toEqual(['unit'])
    expect(EXTENSION_THEME_RADIUS_KEYS).toEqual([
      'xs',
      'sm',
      'md',
      'lg',
      'xl',
      'twoXl',
      'threeXl',
      'fourXl',
    ])
    expect(EXTENSION_THEME_SHADOW_KEYS).toEqual(['twoXs', 'xs', 'sm', 'md', 'lg', 'xl', 'twoXl'])
    expect(EXTENSION_THEME_FOCUS_KEYS).toEqual(['ring', 'shadow'])
    expect(OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES.spacing.unit).toBe('--ow-spacing')
  })

  it('rejects obsolete control-size, elevation, and bespoke-scale shapes', () => {
    const theme = createOpenWaggleExtensionTheme()
    const obsoleteGroups = fromAny<unknown, { tokens: object }>({
      ...theme,
      tokens: {
        ...theme.tokens,
        controlSize: { sm: '24px', md: '30px', lg: '36px' },
        elevation: { card: 'none', overlay: 'none' },
      },
    })
    const obsoleteTypeScale = fromAny<unknown, { tokens: object }>({
      ...theme,
      tokens: {
        ...theme.tokens,
        typography: {
          ...theme.tokens.typography,
          typeScale: {
            caption: { fontSize: '10px', lineHeight: '1.4' },
            label: { fontSize: '11px', lineHeight: '1.3' },
            body: { fontSize: '13px', lineHeight: '1.45' },
            title: { fontSize: '15px', lineHeight: '1.3' },
            code: { fontSize: '13px', lineHeight: '1.55' },
          },
        },
      },
    })

    expect(theme.tokens).not.toHaveProperty('controlSize')
    expect(theme.tokens).not.toHaveProperty('elevation')
    expect(isOpenWaggleExtensionTheme(obsoleteGroups)).toBe(false)
    expect(isOpenWaggleExtensionTheme(obsoleteTypeScale)).toBe(false)
  })
})

describe('createOpenWaggleExtensionUiStylesheet', () => {
  it('uses projected standard variables throughout extension UI', () => {
    const stylesheet = createOpenWaggleExtensionUiStylesheet()

    expect(stylesheet).toContain('font-size: var(--ow-text-sm);')
    expect(stylesheet).toContain('line-height: var(--ow-text-sm--line-height);')
    expect(stylesheet).toContain('padding: calc(var(--ow-spacing) * 4);')
    expect(stylesheet).toContain('min-height: calc(var(--ow-spacing) * 8);')
    expect(stylesheet).toContain('border-radius: var(--ow-radius-3xl);')
    expect(stylesheet).toContain('border-radius: var(--ow-radius-lg);')
    expect(stylesheet).toContain('border-radius: var(--ow-radius-md);')
    expect(stylesheet).toContain('box-shadow: var(--ow-shadow-sm);')
    expect(stylesheet).toContain('.ow-extension-button:disabled,')
    expect(stylesheet).toContain('.ow-extension-root .ow-syntax-block {')
    expect(stylesheet).toContain('font-family: var(--ow-font-family-mono);')
    expect(stylesheet).toContain('color: var(--ow-color-danger-text);')
    expect(stylesheet).toContain('color: var(--ow-color-info-text);')
    expect(stylesheet).not.toContain('--ow-space-')
    expect(stylesheet).not.toContain('--ow-control-')
    expect(stylesheet).not.toContain('--ow-elevation-')
    expect(stylesheet).not.toContain('--ow-type-')
  })
})
