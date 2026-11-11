import type * as AutomationPolicy from '../../../../desktop-automation-policy'
import { vi } from 'vitest'

/**
 * Prepares a fresh Electrobun shell for one contract test: a clean fake of `electrobun/main` and a
 * switch for non-disruptive automation. Import the adapter under test after calling it
 * (`await import('../../electrobun-os-shell')`), so it binds to this fake.
 *
 * The Electrobun SDK is TypeScript source inside the Hutch devkit; in tests `electrobun/main`
 * resolves to the npm bootstrap package, which throws when loaded, so every test that reaches an
 * Electrobun adapter mocks it here.
 */
export async function prepareElectrobunShell() {
  vi.resetModules()
  const { fakeElectrobun } = await import('./fake-electrobun')
  const electrobun = fakeElectrobun()
  const automation = { on: false }
  vi.doMock('electrobun/main', () => ({ ...electrobun.module, default: electrobun.module }))
  vi.doMock('../../../../desktop-automation-policy', async (importOriginal) => ({
    ...(await importOriginal<typeof AutomationPolicy>()),
    isAutomationMode: () => automation.on,
  }))
  return {
    electrobun,
    /** Switches automation on, as startup does under it. */
    enterAutomation: () => {
      automation.on = true
    },
  }
}
