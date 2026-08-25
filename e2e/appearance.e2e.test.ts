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
