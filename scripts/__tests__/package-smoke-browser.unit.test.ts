import { describe, expect, it } from 'vitest'
import { assertStableBrowserRuntime } from '../package-browser-smoke'
import { assertBrowserRuntimeResult } from '../package-smoke-assertions'
import { packageBrowserSmokeEnabled } from '../package-smoke-env'

describe('package browser smoke', () => {
  it('runs only when explicitly enabled', () => {
    expect(packageBrowserSmokeEnabled(undefined)).toBe(false)
    expect(packageBrowserSmokeEnabled('')).toBe(false)
    expect(packageBrowserSmokeEnabled('true')).toBe(false)
    expect(packageBrowserSmokeEnabled('1')).toBe(true)
  })

  it('requires a clean runtime success signal', () => {
    expect(() =>
      assertBrowserRuntimeResult({
        status: 'passed',
        consoleErrors: [],
        pageErrors: [],
      }),
    ).not.toThrow()

    expect(() =>
      assertBrowserRuntimeResult({
        status: 'failed',
        consoleErrors: [],
        pageErrors: [],
      }),
    ).toThrow('reported failed')
    expect(() =>
      assertBrowserRuntimeResult({
        status: 'passed',
        consoleErrors: ['render failed'],
        pageErrors: [],
      }),
    ).toThrow('console errors: render failed')
    expect(() =>
      assertBrowserRuntimeResult({
        status: 'passed',
        consoleErrors: [],
        pageErrors: ['unhandled failure'],
      }),
    ).toThrow('page errors: unhandled failure')
  })

  it('rejects a delayed browser error and status flip after initial success', async () => {
    const consoleErrors: string[] = []
    let status = 'passed'

    await expect(
      assertStableBrowserRuntime({
        readStatus: async () => status,
        consoleErrors,
        pageErrors: [],
        stabilize: async () => {
          await Promise.resolve()
          consoleErrors.push('delayed render failure')
          status = 'failed'
        },
      }),
    ).rejects.toThrow('reported failed; console errors: delayed render failure')
  })
})
