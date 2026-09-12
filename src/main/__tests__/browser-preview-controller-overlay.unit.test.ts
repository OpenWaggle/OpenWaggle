import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  BROWSER_PREVIEW_CONTROLLER_OVERLAY_WORLD_ID,
  browserPreviewControllerOverlayScript,
  synchronizeBrowserPreviewControllerOverlay,
} from '../browser-preview-controller-overlay'

describe('browser preview controller overlay', () => {
  it('keeps pointer coordinates in guest CSS pixels for native zoom and viewport scaling', () => {
    const script = browserPreviewControllerOverlayScript({
      kind: 'agent',
      action: 'click',
      pointer: { x: 24, y: 42 },
    })

    expect(script).toContain('"pointer":{"x":24,"y":42}')
    expect(script).toContain("'translate3d(' + x + 'px,' + y + 'px,0)'")
    expect(script).toContain("controller.action === 'click'")
    expect(script).toContain("host.setAttribute('aria-hidden', 'true')")
  })

  it('runs in a dedicated isolated world and reports successful installation', async () => {
    const executeJavaScriptInIsolatedWorld = vi.fn(async () => true)
    const contents = fromPartial<WebContents>({
      isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld,
    })

    await expect(
      synchronizeBrowserPreviewControllerOverlay(contents, { kind: 'human' }),
    ).resolves.toBe(true)
    expect(executeJavaScriptInIsolatedWorld).toHaveBeenCalledWith(
      BROWSER_PREVIEW_CONTROLLER_OVERLAY_WORLD_ID,
      [{ code: expect.stringContaining('controller.kind') }],
      true,
    )
  })

  it('does not execute against destroyed guest contents', async () => {
    const executeJavaScriptInIsolatedWorld = vi.fn(async () => true)
    const contents = fromPartial<WebContents>({
      isDestroyed: () => true,
      executeJavaScriptInIsolatedWorld,
    })

    await expect(
      synchronizeBrowserPreviewControllerOverlay(contents, { kind: 'human' }),
    ).resolves.toBe(false)
    expect(executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })
})
