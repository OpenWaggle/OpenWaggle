import { fromPartial } from '@total-typescript/shoehorn'
import type { NativeImage, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewAutomationController } from '../browser-preview-automation-control'
import { captureBrowserPreviewPage } from '../browser-preview-capture'
import { BrowserPreviewElementPicker } from '../browser-preview-element-picker'
import { quarantineBrowserPreviewContents } from '../browser-preview-quarantine'
import { createBrowserPreviewAutomationPageFixture as createPage } from './browser-preview-automation-control-test-harness'

describe('quarantined cached native capabilities', () => {
  it('rejects queued automation and stale result publication after owner retirement', async () => {
    const { page } = createPage()
    const controller = new BrowserPreviewAutomationController()
    const entered = Promise.withResolvers<void>()
    const released = Promise.withResolvers<void>()
    const first = controller.run(page, 'running', async () => {
      entered.resolve()
      await released.promise
      return 'private result'
    })
    const queued = vi.fn(async () => 'must not run')
    const second = controller.run(page, 'queued', queued)
    const firstRejected = expect(first).rejects.toThrow('retired')
    const secondRejected = expect(second).rejects.toThrow('retired')
    await entered.promise
    quarantineBrowserPreviewContents(page.contents)
    released.resolve()
    await Promise.all([firstRejected, secondRejected])
    expect(queued).not.toHaveBeenCalled()
    await expect(controller.run(page, 'cached', queued)).rejects.toThrow('retired')
    controller.dispose(page.tabId)
  })

  it.each(['command', 'input cleanup'])(
    'rechecks quarantine after debugger initialization before %s',
    async (operation) => {
      const { page, sendCommand } = createPage()
      const controller = new BrowserPreviewAutomationController()
      const entered = Promise.withResolvers<void>()
      const ready = Promise.withResolvers<void>()
      sendCommand.mockImplementation(async () => {
        entered.resolve()
        await ready.promise
        return {}
      })
      const result = controller.run(page, 'queued-control', (context) =>
        operation === 'command'
          ? context.send('Page.captureScreenshot')
          : context.cleanupInput('Input.dispatchMouseEvent', { type: 'mouseReleased' }),
      )
      const rejected = expect(result).rejects.toThrow('retired')
      await entered.promise
      quarantineBrowserPreviewContents(page.contents)
      ready.resolve()
      await rejected
      expect(sendCommand).not.toHaveBeenCalledWith('Page.captureScreenshot', undefined)
      expect(sendCommand).not.toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.anything())
      controller.dispose(page.tabId)
    },
  )

  it('rejects an in-flight screenshot and never starts its queued successor', async () => {
    const frame = Promise.withResolvers<NativeImage>()
    const capturePage = vi.fn(() => frame.promise)
    const contents = fromPartial<WebContents>({ capturePage, isDestroyed: () => false })
    const first = captureBrowserPreviewPage(contents)
    const second = captureBrowserPreviewPage(contents)
    const failures = [
      expect(first).rejects.toThrow('retired'),
      expect(second).rejects.toThrow('retired'),
    ]
    await Promise.resolve()
    expect(capturePage).toHaveBeenCalledOnce()
    quarantineBrowserPreviewContents(contents)
    frame.resolve(fromPartial<NativeImage>({ isEmpty: () => false }))
    await Promise.all(failures)
    expect(capturePage).toHaveBeenCalledOnce()
  })

  it('does not reinstall an element picker after cancellation crosses owner retirement', async () => {
    const nativePick = Promise.withResolvers<unknown>()
    const execute = vi
      .fn(async (): Promise<unknown> => null)
      .mockImplementationOnce(() => nativePick.promise)
    const contents = fromPartial<WebContents>({
      executeJavaScriptInIsolatedWorld: execute,
      isDestroyed: () => false,
    })
    const picker = new BrowserPreviewElementPicker()
    const first = picker.pick('owner:preview', 'preview', contents)
    const cancelled = Promise.withResolvers<void>()
    const cancel = vi.spyOn(picker, 'cancel').mockReturnValueOnce(cancelled.promise)
    const second = picker.pick('owner:preview', 'preview', contents)
    const rejected = expect(second).rejects.toThrow('retired')
    quarantineBrowserPreviewContents(contents)
    cancelled.resolve()
    await rejected
    expect(execute).toHaveBeenCalledOnce()
    cancel.mockRestore()
    await picker.cancel('owner:preview')
    await first
  })
})
