import { Buffer } from 'node:buffer'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  captureBrowserPreviewFavicon,
  selectBrowserPreviewFaviconCandidates,
} from '../browser-preview-favicon-capture'
import { browserPreviewImageDimensions } from '../browser-preview-favicon-dimensions'
import {
  BrowserPreviewManager,
  createOwner,
  createWindow,
  firstView,
  getBrowserPreviewElectronMocks,
  openInput,
} from './browser-preview-test-harness'

const electronMocks = getBrowserPreviewElectronMocks()
const RASTERIZED_ICON = 'data:image/png;base64,iVBORw0KGgo='

function pngHeader(width = 32, height = 32) {
  const buffer = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer)
  buffer.writeUInt32BE(width, 16)
  buffer.writeUInt32BE(height, 20)
  return buffer
}

function faviconContents(overrides: Partial<WebContents> = {}) {
  return fromPartial<WebContents>({
    executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve(RASTERIZED_ICON)),
    session: fromPartial<WebContents['session']>({ fetch: vi.fn() }),
    ...overrides,
  })
}

describe('browser preview favicon capture', () => {
  beforeEach(() => {
    electronMocks.createdViews.splice(0)
    electronMocks.windowFromWebContents.mockReset()
  })

  it('bounds and deduplicates untrusted favicon candidate lists', () => {
    const candidates = Array.from({ length: 20 }, (_, index) => `https://example.com/${index}.png`)
    expect(selectBrowserPreviewFaviconCandidates([candidates[0] ?? '', ...candidates])).toEqual(
      candidates.slice(0, 8),
    )
  })

  it('rejects unsafe source dimensions before renderer decoding', () => {
    expect(browserPreviewImageDimensions(pngHeader(32, 32))).toEqual({ width: 32, height: 32 })
    expect(browserPreviewImageDimensions(pngHeader(2_000, 2_000))).toBeNull()
  })

  it('rasterizes a bounded inline icon without fetching it', async () => {
    const contents = faviconContents()
    const candidate = `data:image/png;base64,${pngHeader().toString('base64')}`

    await expect(
      captureBrowserPreviewFavicon({
        webContents: contents,
        pageUrl: 'https://example.com/page',
        candidates: [candidate],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ kind: 'captured', dataUrl: RASTERIZED_ICON })
    expect(contents.session.fetch).not.toHaveBeenCalled()
    expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
  })

  it('publishes a favicon only for the live document origin', async () => {
    const ownerFixture = createOwner()
    const ownerWindow = createWindow()
    electronMocks.windowFromWebContents.mockReturnValue(ownerWindow.window)
    const manager = new BrowserPreviewManager()
    manager.open(ownerFixture.owner, openInput())
    const view = firstView()
    view.webContents.executeJavaScriptInIsolatedWorld.mockResolvedValue(RASTERIZED_ICON)
    ownerFixture.send.mockClear()

    view.webContents.emit('page-favicon-updated', {}, [
      `data:image/png;base64,${pngHeader().toString('base64')}`,
    ])
    await vi.waitFor(() => {
      expect(ownerFixture.send).toHaveBeenCalledWith(
        'browser-preview:state',
        expect.objectContaining({
          favicon: expect.objectContaining({
            dataUrl: RASTERIZED_ICON,
            pageUrl: 'https://example.com',
          }),
        }),
      )
    })

    view.webContents.emit('did-navigate', {}, 'https://openwaggle.dev/')
    expect(ownerFixture.send).toHaveBeenLastCalledWith(
      'browser-preview:state',
      expect.objectContaining({ favicon: null }),
    )
  })
})
