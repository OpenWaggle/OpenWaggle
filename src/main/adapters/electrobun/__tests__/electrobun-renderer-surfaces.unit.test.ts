import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareElectrobunShell } from './contracts/electrobun-shell'

const LOOPBACK_PAGE = 'http://127.0.0.1:4000/cap/index.html'
const LOGICAL_PAGE = 'openwaggle://app/index.html'

async function openPage() {
  const shell = await prepareElectrobunShell()
  const surfaces = await import('../electrobun-renderer-surfaces')
  const { openAppWindow } = await import('../electrobun-window-policy')
  const opened: string[] = []
  const window = openAppWindow(
    { hidden: true, url: LOOPBACK_PAGE },
    {
      openLink: (url) => opened.push(url),
      devTools: false,
      logicalUrl: (url) => (url === LOOPBACK_PAGE ? LOGICAL_PAGE : url),
    },
  )
  const view = shell.electrobun.webview.webviewOf(window.webContents.id)
  return { ...shell, surfaces, window, surface: window.webContents, view, opened }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Electrobun renderer surfaces', () => {
  it('reports a trusted page by the URL the app knows it by', async () => {
    const { surface, view } = await openPage()
    const starts: string[] = []
    surface.on('did-start-navigation', (navigation) => starts.push(navigation.url))
    view.emitEvent('will-navigate', JSON.stringify({ url: LOOPBACK_PAGE, allowed: true }))
    view.emitEvent('did-navigate', LOOPBACK_PAGE)
    expect(starts).toEqual([LOGICAL_PAGE])
    expect(surface.getURL()).toBe(LOGICAL_PAGE)
  })

  it('opens a refused navigation and a new-window request outside the app', async () => {
    const { surface, view, opened } = await openPage()
    const starts: string[] = []
    surface.on('did-start-navigation', (navigation) => starts.push(navigation.url))
    view.emitEvent('will-navigate', JSON.stringify({ url: 'https://example.com/', allowed: false }))
    view.emitEvent('new-window-open', { url: 'https://example.com/popup', isCmdClick: false })
    expect(opened).toEqual(['https://example.com/', 'https://example.com/popup'])
    expect(starts).toEqual([])
  })

  it('reloads a page that stopped answering its heartbeat', async () => {
    vi.useFakeTimers()
    const { surfaces, surface, view } = await openPage()
    const gone = vi.fn()
    surface.on('render-process-gone', gone)
    await vi.advanceTimersByTimeAsync(surfaces.HEARTBEAT_INTERVAL_MS * 2)
    expect(gone).not.toHaveBeenCalled()
    view.page.alive = false
    const silence =
      (surfaces.HEARTBEAT_INTERVAL_MS + surfaces.HEARTBEAT_TIMEOUT_MS) * surfaces.HEARTBEAT_MISSES
    await vi.advanceTimersByTimeAsync(silence)
    expect(gone).toHaveBeenCalledTimes(1)
    expect(view.loaded).toEqual([LOOPBACK_PAGE])
  })

  it('carries structured values both ways', async () => {
    const { surface, view } = await openPage()
    const { electrobunIpcMainTransport } = await import('../electrobun-ipc-main-transport')
    electrobunIpcMainTransport.handle('voice:transcribe-local', (_invocation, request) => ({
      bytes: request.pcm16.byteLength,
      at: new Date(0),
    }))
    const pcm16 = new Uint8Array([1, 2, 3])
    await expect(
      view.page.invoke('voice:transcribe-local', { pcm16, sampleRate: 16_000 }),
    ).resolves.toEqual({ bytes: 3, at: new Date(0) })
    surface.send('terminal:event', { missing: undefined, size: 1n })
    expect(view.page.received).toEqual([
      { channel: 'terminal:event', args: [{ missing: undefined, size: 1n }] },
    ])
  })
})
