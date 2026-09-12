import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type { BrowserWindow, HandlerDetails, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_PREVIEW_POPUP_OPTIONS,
  browserPreviewWindowOpenAction,
  installBrowserPreviewPopupPolicy,
} from '../browser-preview-popup-policy'

function details(overrides: Partial<Pick<HandlerDetails, 'disposition' | 'url'>> = {}) {
  return fromPartial<HandlerDetails>({
    disposition: 'new-window',
    url: 'https://accounts.example.test/oauth',
    ...overrides,
  })
}

function fakeContents() {
  const emitter = new EventEmitter()
  const session = {}
  let windowOpenHandler: ((input: HandlerDetails) => unknown) | null = null
  const contents = fromPartial<WebContents>({
    on: emitter.on.bind(emitter),
    removeListener: emitter.removeListener.bind(emitter),
    session,
    setWindowOpenHandler: vi.fn((handler) => {
      windowOpenHandler = handler
    }),
  })
  return {
    contents,
    emitter,
    invoke: (input: HandlerDetails) => windowOpenHandler?.(input),
    session,
  }
}

function fakePopup() {
  const windowEvents = new EventEmitter()
  const contentsEvents = new EventEmitter()
  const webContents = fromPartial<WebContents>({
    isDestroyed: () => false,
    on: contentsEvents.on.bind(contentsEvents),
    removeListener: contentsEvents.removeListener.bind(contentsEvents),
    setIgnoreMenuShortcuts: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  })
  const popup = fromPartial<BrowserWindow>({
    close: vi.fn(),
    isDestroyed: () => false,
    once: windowEvents.once.bind(windowEvents),
    webContents,
  })
  return { contentsEvents, popup, webContents, windowEvents }
}

describe('browser preview OAuth popup policy', () => {
  it('allows only scripted HTTP(S) popups outside automation', () => {
    expect(browserPreviewWindowOpenAction(details(), false)).toBe('popup')
    expect(browserPreviewWindowOpenAction(details({ disposition: 'foreground-tab' }), false)).toBe(
      'navigate',
    )
    expect(browserPreviewWindowOpenAction(details({ url: 'about:blank' }), false)).toBe('block')
    expect(browserPreviewWindowOpenAction(details(), true)).toBe('block')
    expect(BROWSER_PREVIEW_POPUP_OPTIONS.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false,
    })
  })

  it('keeps tab links in the preview and bounds real popup count', () => {
    const source = fakeContents()
    const navigate = vi.fn()
    const onBlocked = vi.fn()
    const policy = installBrowserPreviewPopupPolicy(source.contents, { navigate, onBlocked })
    const tabResult = source.invoke(
      details({ disposition: 'foreground-tab', url: 'https://example.test/docs' }),
    )
    expect(tabResult).toEqual({ action: 'deny' })
    expect(navigate).toHaveBeenCalledWith('https://example.test/docs')

    const firstResult = source.invoke(details())
    const secondResult = source.invoke(details({ url: 'https://login.example.test/' }))
    const thirdResult = source.invoke(details({ url: 'https://third.example.test/' }))
    expect(firstResult).toMatchObject({ action: 'allow' })
    expect(firstResult).toMatchObject({
      overrideBrowserWindowOptions: { webPreferences: { session: source.session } },
    })
    expect(secondResult).toMatchObject({ action: 'allow' })
    expect(thirdResult).toEqual({ action: 'deny' })
    expect(onBlocked).toHaveBeenLastCalledWith('https://third.example.test/')
    expect(policy.popupCount()).toBe(2)
  })

  it('blocks nested popups and unsafe popup navigation, then closes children on dispose', () => {
    const source = fakeContents()
    const policy = installBrowserPreviewPopupPolicy(source.contents, {
      navigate: vi.fn(),
      onBlocked: vi.fn(),
    })
    expect(source.invoke(details())).toMatchObject({ action: 'allow' })
    const child = fakePopup()
    source.emitter.emit('did-create-window', child.popup)
    source.emitter.emit('did-create-window', child.popup)
    expect(child.contentsEvents.listenerCount('context-menu')).toBe(1)

    expect(child.webContents.setWindowOpenHandler).toHaveBeenCalledOnce()
    expect(child.webContents.setIgnoreMenuShortcuts).toHaveBeenCalledExactlyOnceWith(true)
    const preventDefault = vi.fn()
    child.contentsEvents.emit('will-navigate', { preventDefault }, 'file:///etc/passwd')
    expect(preventDefault).toHaveBeenCalledOnce()

    policy.dispose()
    expect(child.popup.close).toHaveBeenCalledOnce()
    expect(policy.popupCount()).toBe(0)
    child.windowEvents.emit('closed')
    expect(child.contentsEvents.listenerCount('context-menu')).toBe(0)
  })
})
