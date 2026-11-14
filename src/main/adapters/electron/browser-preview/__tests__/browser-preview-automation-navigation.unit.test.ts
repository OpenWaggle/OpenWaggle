import { describe, expect, it, vi } from 'vitest'
import { navigateBrowserPreviewAndWait } from '../browser-preview-automation-navigation'
import {
  navigationContents,
  navigationOperation,
} from './browser-preview-automation-navigation-test-harness'

describe('navigateBrowserPreviewAndWait', () => {
  it('ignores stale readiness until the expected main-frame navigation starts', async () => {
    const { contents, events, setCurrentUrl } = navigationContents()
    const load = navigationOperation()
    const navigate = vi.fn(() => load.operation)
    let settled = false
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/next',
      readiness: 'domContentLoaded',
      timeoutMs: 1_000,
      navigate,
    })
    void pending.then(() => {
      settled = true
    })

    events.emit('dom-ready')
    await Promise.resolve()
    expect(settled).toBe(false)

    setCurrentUrl('https://example.com/next')
    events.emit(
      'did-start-navigation',
      {
        url: 'https://example.com/next',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://example.com/next',
      false,
      true,
    )
    events.emit('dom-ready')
    load.resolve()
    await pending

    expect(navigate).toHaveBeenCalledOnce()
  })

  it('rejects a main-frame load failure from the requested navigation', async () => {
    const failed = navigationContents()
    const load = navigationOperation()
    const failure = navigateBrowserPreviewAndWait({
      contents: failed.contents,
      url: 'https://example.com/failing',
      readiness: 'load',
      timeoutMs: 1_000,
      navigate: () => {
        failed.events.emit(
          'did-start-navigation',
          {
            url: 'https://example.com/failing',
            isSameDocument: false,
            isMainFrame: true,
          },
          'https://example.com/failing',
          false,
          true,
        )
        failed.events.emit(
          'did-fail-load',
          {},
          -102,
          'Connection refused',
          'https://example.com/failing',
          true,
        )
        return load.operation
      },
    })
    await expect(failure).rejects.toThrow('Connection refused')
    expect(failed.events.listenerCount('did-finish-load')).toBe(0)
  })

  it('ignores a stale failure from the navigation that the requested load replaced', async () => {
    const { contents, events, setCurrentUrl } = navigationContents()
    const load = navigationOperation()
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/current',
      readiness: 'load',
      timeoutMs: 1_000,
      navigate: () => load.operation,
    })
    let settled = false
    void pending.finally(() => {
      settled = true
    })

    events.emit(
      'did-start-navigation',
      {
        url: 'https://example.com/current',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://example.com/current',
      false,
      true,
    )
    events.emit(
      'did-fail-load',
      {},
      -102,
      'Old connection refused',
      'https://example.com/old',
      true,
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    setCurrentUrl('https://example.com/current')
    events.emit('did-finish-load')
    load.resolve()
    await pending
  })

  it('stops only the current requested load when its caller aborts', async () => {
    const { contents, events } = navigationContents()
    const load = navigationOperation()
    const abort = new AbortController()
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/current',
      readiness: 'load',
      timeoutMs: 1_000,
      signal: abort.signal,
      navigate: () => load.operation,
    })
    events.emit(
      'did-start-navigation',
      {
        url: 'https://example.com/current',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://example.com/current',
      false,
      true,
    )

    abort.abort()

    await expect(pending).rejects.toThrow('cancelled')
    expect(load.operation.stop).toHaveBeenCalledOnce()
    expect(events.listenerCount('did-finish-load')).toBe(0)
    expect(events.listenerCount('did-start-navigation')).toBe(0)
  })

  it('rejects an older wait without stopping the navigation that superseded it', async () => {
    const { contents, events, setCurrentUrl } = navigationContents()
    const firstLoad = navigationOperation()
    const secondLoad = navigationOperation()
    const first = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/first',
      readiness: 'load',
      timeoutMs: 1_000,
      navigate: () => firstLoad.operation,
    })
    const firstRejection = expect(first).rejects.toThrow('superseded')

    firstLoad.supersede()
    const second = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/second',
      readiness: 'load',
      timeoutMs: 1_000,
      navigate: () => secondLoad.operation,
    })
    setCurrentUrl('https://example.com/second')
    events.emit(
      'did-start-navigation',
      {
        url: 'https://example.com/second',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://example.com/second',
      false,
      true,
    )
    secondLoad.resolve()

    await firstRejection
    await second
    expect(firstLoad.operation.stop).not.toHaveBeenCalled()
  })

  it('follows a correlated server redirect even when the initial load reports ERR_ABORTED', async () => {
    const { contents, events, setCurrentUrl } = navigationContents()
    const load = navigationOperation()
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/start',
      readiness: 'load',
      timeoutMs: 1_000,
      navigate: () => load.operation,
    })
    events.emit(
      'did-start-navigation',
      {
        url: 'https://example.com/start',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://example.com/start',
      false,
      true,
    )
    events.emit(
      'will-redirect',
      {
        url: 'https://www.example.com/final',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://www.example.com/final',
      false,
      true,
    )
    load.reject(Object.assign(new Error('ERR_ABORTED (-3)'), { code: 'ERR_ABORTED', errno: -3 }))
    await Promise.resolve()

    setCurrentUrl('https://www.example.com/final')
    events.emit('did-finish-load')

    await expect(pending).resolves.toBeUndefined()
  })

  it('does not claim or stop an unrelated main-frame navigation', async () => {
    const { contents, events } = navigationContents()
    const load = navigationOperation()
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/requested',
      readiness: 'load',
      timeoutMs: 1_000,
      navigate: () => load.operation,
    })

    events.emit(
      'did-start-navigation',
      {
        url: 'https://example.com/human-choice',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://example.com/human-choice',
      false,
      true,
    )

    await expect(pending).rejects.toThrow('superseded')
    expect(load.operation.stop).not.toHaveBeenCalled()
  })

  it('rejects promptly when the manager generation changes before completion', async () => {
    const { contents, events, setCurrentUrl } = navigationContents()
    const load = navigationOperation()
    const pending = navigateBrowserPreviewAndWait({
      contents,
      url: 'https://example.com/requested',
      readiness: 'load',
      timeoutMs: 50,
      navigate: () => load.operation,
    })
    setCurrentUrl('https://example.com/requested')
    events.emit(
      'did-start-navigation',
      {
        url: 'https://example.com/requested',
        isSameDocument: false,
        isMainFrame: true,
      },
      'https://example.com/requested',
      false,
      true,
    )

    load.supersede()
    load.resolve()

    await expect(pending).rejects.toThrow('superseded')
  })
})
