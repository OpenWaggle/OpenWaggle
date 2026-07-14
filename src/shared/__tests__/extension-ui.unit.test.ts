import {
  createOpenWaggleExtensionTheme,
  createOpenWaggleExtensionUiStylesheet,
  extensionThemeCssVariableDeclarations,
  isOpenWaggleExtensionTheme,
  OPENWAGGLE_EXTENSION_UI_ATTRIBUTES,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES,
  openWaggleExtensionClassName,
} from '@shared/extension-sdk'
import { describe, expect, it } from 'vitest'

describe('OpenWaggle extension UI helpers', () => {
  it('creates framework-neutral class names', () => {
    expect(
      openWaggleExtensionClassName(
        OPENWAGGLE_EXTENSION_UI_CLASS_NAMES.root,
        '',
        false,
        null,
        undefined,
        'custom-panel',
      ),
    ).toBe('ow-extension-root custom-panel')
  })

  it('serializes theme variables and optional UI CSS without framework imports', () => {
    const theme = createOpenWaggleExtensionTheme({
      resolveCssVariable: (cssVariable, fallback) =>
        cssVariable === '--color-accent' ? '#ffcc00' : fallback,
    })

    const declarations = extensionThemeCssVariableDeclarations(theme)
    const stylesheet = createOpenWaggleExtensionUiStylesheet({ theme })

    expect(isOpenWaggleExtensionTheme(theme)).toBe(true)
    expect(declarations).toContain('--ow-color-accent: #ffcc00;')
    expect(stylesheet).toContain('.ow-extension-root {')
    expect(stylesheet).toContain('[data-ow-variant="primary"]')
    expect(stylesheet).toContain('[data-ow-tone="success"]')
    expect(OPENWAGGLE_EXTENSION_UI_ATTRIBUTES.variant).toBe('data-ow-variant')
  })

  it('can emit only class rules when a host already provides theme variables', () => {
    const stylesheet = createOpenWaggleExtensionUiStylesheet({
      includeThemeVariables: false,
      scopeSelector: '.sample-extension',
    })

    expect(stylesheet).toContain('.sample-extension .ow-extension-panel')
    expect(stylesheet).not.toContain('--ow-color-background:')
  })
})
