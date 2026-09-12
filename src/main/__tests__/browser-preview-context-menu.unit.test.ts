import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type {
  BrowserWindow,
  ContextMenuParams,
  KeyboardEvent,
  MenuItem,
  MenuItemConstructorOptions,
  PopupOptions,
  WebContents,
  WebFrameMain,
} from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  build: vi.fn<(template: MenuItemConstructorOptions[]) => void>(),
  popup: vi.fn<(options: PopupOptions) => void>(),
  closePopup: vi.fn(),
  writeText: vi.fn(),
}))
vi.mock('electron', () => ({
  clipboard: { writeText: native.writeText },
  Menu: {
    buildFromTemplate: (template: MenuItemConstructorOptions[]) => {
      native.build(template)
      return { popup: native.popup, closePopup: native.closePopup }
    },
  },
}))
vi.mock('../env', () => ({ env: {}, getSafeChildEnv: () => ({}) }))

const { installBrowserPreviewContextMenu } = await import('../browser-preview-context-menu')

function setup() {
  const events = new EventEmitter()
  const contents = fromPartial<WebContents>({
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
    isDestroyed: vi.fn(() => false),
    focus: vi.fn(),
    copyImageAt: vi.fn(),
    replaceMisspelling: vi.fn(),
  })
  const window = fromPartial<BrowserWindow>({ isDestroyed: () => false })
  const frame = fromPartial<WebFrameMain>({ detached: false })
  const params = fromPartial<ContextMenuParams>({
    frame,
    x: 12,
    y: 34,
    misspelledWord: 'helo',
    dictionarySuggestions: ['hello'],
    linkURL: 'https://example.test/image.png',
    mediaType: 'image',
    editFlags: {
      canUndo: true,
      canRedo: false,
      canCut: false,
      canCopy: true,
      canPaste: true,
      canSelectAll: true,
    },
  })
  const dispose = installBrowserPreviewContextMenu(contents, window)
  const preventDefault = vi.fn()
  const open = (overrides: Partial<ContextMenuParams> = {}) =>
    events.emit('context-menu', { preventDefault }, { ...params, ...overrides })
  return { contents, window, frame, params, events, dispose, open, preventDefault }
}

function template() {
  const result = native.build.mock.lastCall?.[0]
  if (!result) throw new Error('Expected a native menu')
  return result
}

function click(item: MenuItemConstructorOptions | undefined) {
  if (!item?.click) throw new Error('Expected an actionable menu item')
  item.click(fromPartial<MenuItem>({}), undefined, fromPartial<KeyboardEvent>({}))
}

describe('preview native context menus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('targets the clicked guest and frame, retaining native edit capabilities', () => {
    const test = setup()
    native.popup.mockImplementationOnce(() => expect(test.contents.focus).toHaveBeenCalledOnce())
    test.open()
    expect(test.preventDefault).toHaveBeenCalledOnce()
    expect(native.popup).toHaveBeenCalledWith({ window: test.window, frame: test.frame })
    expect(template().filter((item) => item.role)).toEqual([
      { role: 'undo', enabled: true },
      { role: 'redo', enabled: false },
      { role: 'cut', enabled: false },
      { role: 'copy', enabled: true },
      { role: 'paste', enabled: true },
      { role: 'selectAll', enabled: true },
    ])
    click(template().find((item) => item.label === 'hello'))
    click(template().find((item) => item.label === 'Copy Image'))
    click(template().find((item) => item.label === 'Copy Link'))
    expect(test.contents.replaceMisspelling).toHaveBeenCalledWith('hello')
    expect(test.contents.copyImageAt).toHaveBeenCalledWith(12, 34)
    expect(native.writeText).toHaveBeenCalledWith('https://example.test/image.png')
    test.dispose()
  })

  it.each(['javascript:alert(1)', 'file:///private/file', 'https://user:secret@example.test/'])(
    'does not offer copying an unsafe link: %s',
    (linkURL) => {
      const test = setup()
      test.open({ linkURL, frame: null, dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f'] })
      expect(template().some((item) => item.label === 'Copy Link')).toBe(false)
      expect(template().filter((item) => item.label && item.label !== 'Copy Image')).toHaveLength(5)
      expect(native.popup).toHaveBeenCalledWith({ window: test.window })
      test.dispose()
    },
  )

  it('dismisses and revokes stale actions on navigation, replacement, and disposal', () => {
    const test = setup()
    test.open()
    const oldAction = template().find((item) => item.label === 'hello')
    test.events.emit('did-start-navigation')
    click(oldAction)
    expect(test.contents.replaceMisspelling).not.toHaveBeenCalled()
    expect(native.closePopup).toHaveBeenCalledWith(test.window)
    test.open()
    const replacedAction = template().find((item) => item.label === 'Copy Image')
    test.open()
    click(replacedAction)
    expect(test.contents.copyImageAt).not.toHaveBeenCalled()
    const disposedAction = template().find((item) => item.label === 'Copy Link')
    test.dispose()
    click(disposedAction)
    expect(native.writeText).not.toHaveBeenCalled()
    expect(test.events.listenerCount('context-menu')).toBe(0)
    expect(test.events.listenerCount('did-start-navigation')).toBe(0)
  })

  it('does not target a detached frame or destroyed guest', () => {
    const test = setup()
    test.open({ frame: fromPartial<WebFrameMain>({ detached: true }) })
    expect(native.popup).not.toHaveBeenCalled()
    test.open()
    const action = template().find((item) => item.label === 'hello')
    vi.mocked(test.contents.isDestroyed).mockReturnValue(true)
    click(action)
    test.open()
    expect(native.popup).toHaveBeenCalledOnce()
    expect(test.contents.replaceMisspelling).not.toHaveBeenCalled()
    test.dispose()
  })
})
