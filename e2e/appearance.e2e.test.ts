import { expect, type Page, test } from '@playwright/test'
import { OpenWaggleApp } from './support/openwaggle-app'

/**
 * The Appearance override layer, verified in the real app.
 *
 * jsdom cannot compute styles, so the claim that every Design token contract role
 * re-renders under the debug Appearance can only be made in Electron: flip the attribute
 * and read the computed custom properties off `document.documentElement`.
 *
 * The debug Appearance is production-gated: without the explicit test flag the hook
 * refuses it, and with the flag every contract role's computed value must change.
 */

const SET_APPEARANCE_HOOK = '__openwaggleSetAppearance'
const DEBUG_APPEARANCE_TEST_FLAG = '__openwaggleAllowDebugAppearance'

const CONTRACT_ROLE_CSS_VARIABLES = [
  '--color-bg',
  '--color-bg-secondary',
  '--color-bg-tertiary',
  '--color-bg-hover',
  '--color-bg-active',
  '--color-border',
  '--color-border-light',
  '--color-text-primary',
  '--color-text-secondary',
  '--color-text-tertiary',
  '--color-text-muted',
  '--color-accent',
  '--color-accent-dim',
  '--color-success',
  '--color-error',
  '--color-error-text',
  '--color-warning',
  '--color-info',
  '--color-info-text',
  '--color-review',
  '--color-plan',
  '--color-progress',
  '--color-neutral',
  '--font-sans',
  '--font-mono',
  '--text-xs',
  '--text-xs--line-height',
  '--text-sm',
  '--text-sm--line-height',
  '--text-base',
  '--text-base--line-height',
  '--text-lg',
  '--text-lg--line-height',
  '--text-xl',
  '--text-xl--line-height',
  '--text-2xl',
  '--text-2xl--line-height',
  '--spacing',
  '--radius-xs',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--radius-xl',
  '--radius-2xl',
  '--radius-3xl',
  '--radius-4xl',
  '--shadow-2xs',
  '--shadow-xs',
  '--shadow-sm',
  '--shadow-md',
  '--shadow-lg',
  '--shadow-xl',
  '--shadow-2xl',
  '--focus-ring',
  '--focus-shadow',
]

function readComputedVariables(page: Page) {
  return page.evaluate((variableNames) => {
    const styles = window.getComputedStyle(document.documentElement)
    return Object.fromEntries(
      variableNames.map((name) => [name, styles.getPropertyValue(name).trim()]),
    )
  }, CONTRACT_ROLE_CSS_VARIABLES)
}

test('appearance: every contract role re-renders under the debug appearance', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-appearance-e2e-')

  try {
    const { page } = app.mainWindow()

    const setAppearanceExists = await page.evaluate((hookName) => {
      return typeof Reflect.get(window, hookName) === 'function'
    }, SET_APPEARANCE_HOOK)
    expect(setAppearanceExists).toBe(true)

    const darkValues = await readComputedVariables(page)

    for (const variable of CONTRACT_ROLE_CSS_VARIABLES) {
      expect(darkValues[variable], `dark ${variable}`).not.toBe('')
    }

    await page.evaluate((hookName) => {
      const hook = Reflect.get(window, hookName)
      if (typeof hook === 'function') {
        Reflect.apply(hook, window, ['dark'])
      }
    }, SET_APPEARANCE_HOOK)
    expect(await readComputedVariables(page)).toEqual(darkValues)

    const debugRejectedWithoutFlag = await page.evaluate(
      ({ hookName }) => {
        const hook = Reflect.get(window, hookName)
        if (typeof hook !== 'function') {
          return false
        }

        try {
          Reflect.apply(hook, window, ['debug'])
          return false
        } catch {
          return true
        }
      },
      { hookName: SET_APPEARANCE_HOOK },
    )
    expect(debugRejectedWithoutFlag).toBe(true)

    await page.evaluate((flagName) => {
      Reflect.set(window, flagName, true)
    }, DEBUG_APPEARANCE_TEST_FLAG)
    await page.evaluate((hookName) => {
      const hook = Reflect.get(window, hookName)
      if (typeof hook === 'function') {
        Reflect.apply(hook, window, ['debug'])
      }
    }, SET_APPEARANCE_HOOK)

    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('debug')

    const debugValues = await readComputedVariables(page)

    const unchanged = CONTRACT_ROLE_CSS_VARIABLES.filter(
      (variable) => debugValues[variable] === darkValues[variable],
    )
    expect(unchanged).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('appearance: syntax theme selection survives a renderer reload', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-syntax-theme-persistence-e2e-')

  try {
    const { page } = app.mainWindow()
    const tokenizationWarnings: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('Time limit reached when tokenizing line')) {
        tokenizationWarnings.push(message.text())
      }
    })

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    await expect(page.getByRole('combobox', { name: 'Preview language' })).toHaveValue('typescript')
    const typescriptPreview = page.getByRole('region', {
      name: 'TypeScript syntax theme preview',
    })
    await expect(typescriptPreview).toHaveAttribute('data-syntax-status', 'highlighted')
    await expect
      .poll(async () => {
        return typescriptPreview
          .locator('span[style*="color"]')
          .evaluateAll((tokens) => new Set(tokens.map((token) => getComputedStyle(token).color)).size)
      })
      .toBeGreaterThan(1)

    await page.getByRole('combobox', { name: 'Preview language' }).selectOption('python')
    await expect(page.getByRole('combobox', { name: 'Preview language' })).toHaveValue('python')
    const pythonPreview = page.getByRole('region', { name: 'Python syntax theme preview' })
    await expect(pythonPreview).toHaveAttribute('data-syntax-status', 'highlighted')
    await expect(pythonPreview).toContainText('@dataclass')
    await page.getByRole('button', { name: 'GitHub Dark, Dark' }).click()

    await expect
      .poll(async () => {
        const settings = await page.evaluate(() => window.api.getSettings())
        return settings.syntaxThemeSelections.dark
      })
      .toBe('bundled:github-dark')

    await page.reload()

    await expect(page.getByRole('button', { name: 'GitHub Dark, Dark' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(tokenizationWarnings).toEqual([])
  } finally {
    await app.cleanup()
  }
})

test('appearance: typography and motion preferences survive a renderer reload', async () => {
  const app = await OpenWaggleApp.launch('openwaggle-typography-persistence-e2e-')

  try {
    const { page } = app.mainWindow()

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Appearance' }).click()

    const codePreview = page
      .getByRole('region', { name: 'TypeScript syntax theme preview' })
      .locator('.syntax-typography')
    await expect(codePreview).toBeVisible()
    const initialCodeFont = await codePreview.evaluate((element) => getComputedStyle(element).fontFamily)
    await page.getByRole('button', { name: 'Interface font: System UI' }).click()
    await page.getByRole('menuitemradio', { name: 'Georgia' }).click()
    await page.getByRole('button', { name: 'Code font: System monospace' }).click()
    await page.getByRole('menuitemradio', { name: 'Menlo' }).click()
    await page.getByRole('button', { name: 'Increase Interface scale' }).click()
    await page.getByRole('switch', { name: 'Reduce motion' }).click()

    await expect
      .poll(() => codePreview.evaluate((element) => getComputedStyle(element).fontFamily))
      .not.toBe(initialCodeFont)
    expect(await codePreview.evaluate((element) => getComputedStyle(element).fontFamily)).toMatch(
      /^Menlo/u,
    )

    await expect
      .poll(async () => {
        const settings = await page.evaluate(() => window.api.getSettings())
        return settings.appearancePreferences
      })
      .toEqual(
        expect.objectContaining({
          motion: 'reduced',
          typography: expect.objectContaining({
            interfaceFontFamily: 'Georgia, serif',
            interfaceScale: 105,
            codeFontFamily:
              'Menlo, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }),
        }),
      )

    await page.reload()

    await expect(page.getByRole('button', { name: 'Interface font: Georgia' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Code font: Menlo' })).toBeVisible()
    await expect(page.getByRole('spinbutton', { name: 'Interface scale' })).toHaveValue('105')
    await expect(page.getByRole('switch', { name: 'Reduce motion' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(
      await page.evaluate(() => ({
        fontFamily: document.documentElement.style.getPropertyValue('--font-sans'),
        fontSize: document.documentElement.style.fontSize,
        motion: document.documentElement.dataset.motion,
      })),
    ).toEqual({ fontFamily: 'Georgia, serif', fontSize: '105%', motion: 'reduced' })
    await expect
      .poll(() => codePreview.evaluate((element) => getComputedStyle(element).fontFamily))
      .toMatch(/^Menlo/u)
  } finally {
    await app.cleanup()
  }
})
