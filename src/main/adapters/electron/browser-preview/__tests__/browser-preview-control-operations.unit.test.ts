import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewControlOperations } from '../browser-preview-control-operations'

function createContents() {
  const listeners = new Map<string, () => void>()
  const contents = fromPartial<WebContents>({
    devToolsWebContents: fromPartial<WebContents>({ focus: vi.fn() }),
    isDestroyed: () => false,
    isDevToolsOpened: vi.fn(() => false),
    once: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener)
      return contents
    }),
    openDevTools: vi.fn(),
    reloadIgnoringCache: vi.fn(),
    session: fromPartial<WebContents['session']>({
      clearCache: vi.fn(async () => undefined),
      clearStorageData: vi.fn(async () => undefined),
    }),
  })
  return { contents, listeners }
}

describe('BrowserPreviewControlOperations', () => {
  let controls: BrowserPreviewControlOperations
  const broker = {
    sendControl: vi.fn(async () => undefined),
    releaseForDevTools: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    controls = new BrowserPreviewControlOperations(broker)
  })

  it('serializes appearance control through the shared automation broker', async () => {
    const { contents } = createContents()

    await controls.register('preview-1', contents, 'system')
    await controls.setAppearance('preview-1', contents, 'dark')

    expect(broker.sendControl).toHaveBeenLastCalledWith(
      { tabId: 'preview-1', contents },
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-color-scheme', value: 'dark' }] },
    )
  })

  it('releases the broker for detached DevTools and restores appearance when they close', async () => {
    const { contents, listeners } = createContents()
    await controls.register('preview-1', contents, 'light')

    await controls.openDevTools('preview-1', contents)
    listeners.get('devtools-closed')?.()
    await vi.waitFor(() => expect(broker.sendControl).toHaveBeenCalledTimes(2))

    expect(broker.releaseForDevTools).toHaveBeenCalledExactlyOnceWith('preview-1')
    expect(contents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
    expect(broker.sendControl).toHaveBeenLastCalledWith(
      { tabId: 'preview-1', contents },
      'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-color-scheme', value: 'light' }] },
    )
  })

  it('hard reloads and clears only the selected preview session', async () => {
    const { contents } = createContents()

    controls.hardReload(contents)
    await controls.clearCookies(contents)
    await controls.clearCache(contents)

    expect(contents.reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(contents.session.clearStorageData).toHaveBeenCalledWith({ storages: ['cookies'] })
    expect(contents.session.clearCache).toHaveBeenCalledOnce()
  })

  it('releases broker ownership when a preview is disposed', async () => {
    const { contents } = createContents()

    await controls.register('preview-1', contents, 'dark')
    controls.dispose('preview-1')

    expect(broker.releaseForDevTools).toHaveBeenCalledExactlyOnceWith('preview-1')
  })
})
