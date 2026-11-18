import { describe, expect, it } from 'vitest'
import {
  resolveBrowserPreviewAutomationNavigationUrl,
  resolveBrowserPreviewAutomationViewport,
  validateBrowserPreviewAutomationClick,
  validateBrowserPreviewAutomationOpen,
  validateBrowserPreviewAutomationWait,
} from '../browser-preview-automation-validation'

describe('browser preview automation validation', () => {
  it('normalizes public and environment-relative navigation targets', () => {
    expect(resolveBrowserPreviewAutomationNavigationUrl({ url: 'example.com' })).toBe(
      'https://example.com/',
    )
    expect(
      resolveBrowserPreviewAutomationNavigationUrl({
        target: { kind: 'environment-port', port: 5173, path: '/settings?tab=account' },
      }),
    ).toBe('http://localhost:5173/settings?tab=account')
  })

  it('prevents environment paths from replacing the trusted local origin', () => {
    expect(() =>
      resolveBrowserPreviewAutomationNavigationUrl({
        target: { kind: 'environment-port', port: 5173, path: '//attacker.test/' },
      }),
    ).toThrow('cannot replace the target origin')
    expect(() =>
      resolveBrowserPreviewAutomationNavigationUrl({
        target: { kind: 'environment-port', port: 5173, path: '/\\attacker.test/' },
      }),
    ).toThrow('cannot replace the target origin')
  })

  it('rejects ambiguous open and click targets', () => {
    expect(() =>
      validateBrowserPreviewAutomationOpen({
        tabId: 'tab-1',
        reuseExistingTab: false,
      }),
    ).toThrow('cannot be combined')
    expect(() =>
      validateBrowserPreviewAutomationClick({ selector: '#save', locator: 'text=Save' }),
    ).toThrow('at most one')
  })

  it('resolves freeform and oriented preset viewports', () => {
    expect(
      resolveBrowserPreviewAutomationViewport({ mode: 'freeform', width: 1_024, height: 768 }),
    ).toEqual({ mode: 'fixed', width: 1_024, height: 768, presetId: null })
    expect(
      resolveBrowserPreviewAutomationViewport({
        mode: 'preset',
        preset: 'iphone-12-pro',
        orientation: 'landscape',
      }),
    ).toEqual({ mode: 'fixed', width: 844, height: 390, presetId: 'iphone-12-pro' })
  })

  it('requires at least one wait condition', () => {
    expect(() => validateBrowserPreviewAutomationWait({})).toThrow('at least one')
  })
})
