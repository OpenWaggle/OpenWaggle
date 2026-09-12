import { describe, expect, it } from 'vitest'
import {
  extractPlaywrightInjectedSource,
  playwrightInjectedRuntimeInstallExpression,
} from '../browser-preview-playwright-runtime'

describe('browser preview Playwright injected runtime', () => {
  it('extracts a JavaScript string literal without evaluating ambient authority', () => {
    const bundle = [
      '// packages/playwright-core/src/generated/injectedScriptSource.ts',
      'source4 = "runtime-source";\n  }\n}); suffix',
    ].join('\n')

    expect(extractPlaywrightInjectedSource(bundle, 4)).toBe('runtime-source')
  })

  it('rejects bundles without the expected source boundary', () => {
    expect(() => extractPlaywrightInjectedSource('const source = "wrong";', 1)).toThrow(
      'section was not found',
    )
  })

  it('builds an installation expression from the installed Playwright bundle', async () => {
    const expression = await playwrightInjectedRuntimeInstallExpression()

    expect(expression.length).toBeGreaterThan(100_000)
    expect(expression).toContain('__openWagglePlaywrightInjected')
    expect(expression).toContain('InjectedScript')
  })
})
