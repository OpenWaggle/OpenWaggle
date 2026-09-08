import { describe, expect, it } from 'vitest'
import { navigateBrowserPreviewAndWait } from '../browser-preview-automation-navigation'
import {
  navigationContents,
  navigationOperation,
} from './browser-preview-automation-navigation-test-harness'

describe('browser preview same-document navigation', () => {
  it('completes without waiting for a load event', async () => {
    const { contents, events } = navigationContents()
    const load = navigationOperation()
    const url = 'https://example.com/page#details'
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url,
      readiness: 'load',
      timeoutMs: 1_000,
      navigate: () => {
        events.emit(
          'did-start-navigation',
          { url, isSameDocument: true, isMainFrame: true },
          url,
          true,
          true,
        )
        return load.operation
      },
    })

    await expect(pending).resolves.toBeUndefined()
    expect(events.listenerCount('did-finish-load')).toBe(0)
    expect(events.listenerCount('did-navigate-in-page')).toBe(0)
  })

  it('recognizes did-navigate-in-page when Chromium omits the start event', async () => {
    const { contents, events } = navigationContents()
    const load = navigationOperation()
    const url = 'https://example.com/page#details'
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url,
      readiness: 'domContentLoaded',
      timeoutMs: 1_000,
      navigate: () => {
        events.emit('did-navigate-in-page', {}, url, true, 1, 1)
        return load.operation
      },
    })

    await expect(pending).resolves.toBeUndefined()
  })
})
