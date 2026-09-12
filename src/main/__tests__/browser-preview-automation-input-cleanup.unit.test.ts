import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type { Debugger, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { BrowserPreviewAutomationController } from '../browser-preview-automation-control'

function createPage() {
  const contentsEvents = new EventEmitter()
  const debuggerEvents = new EventEmitter()
  let attached = false
  const sendCommand = vi.fn(async (): Promise<unknown> => ({}))
  const browserDebugger = fromPartial<Debugger>({
    on: debuggerEvents.on.bind(debuggerEvents),
    removeListener: debuggerEvents.removeListener.bind(debuggerEvents),
    attach: vi.fn(() => {
      attached = true
    }),
    detach: vi.fn(() => {
      attached = false
    }),
    isAttached: () => attached,
    sendCommand,
  })
  const contents = fromPartial<WebContents>({
    id: 1,
    debugger: browserDebugger,
    getBackgroundThrottling: () => true,
    isDevToolsOpened: () => false,
    isDestroyed: () => false,
    on: contentsEvents.on.bind(contentsEvents),
    once: contentsEvents.once.bind(contentsEvents),
    removeListener: contentsEvents.removeListener.bind(contentsEvents),
    setBackgroundThrottling: vi.fn(),
  })
  return { contentsEvents, page: { tabId: 'tab-1', contents }, sendCommand }
}

describe('browser preview automation input cleanup', () => {
  it('allows input release after human input invalidates the action epoch', async () => {
    const controller = new BrowserPreviewAutomationController()
    const { contentsEvents, page, sendCommand } = createPage()

    await expect(
      controller.run(page, 'click', async (context) => {
        await context.dispatchInput('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: 12,
          y: 18,
          button: 'left',
        })
        contentsEvents.emit('before-mouse-event', {}, {})
        await context.cleanupInput('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: 12,
          y: 18,
          button: 'left',
        })
        await context.send('Page.getFrameTree')
      }),
    ).rejects.toThrow('interrupted by human input')

    expect(sendCommand).toHaveBeenCalledWith('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 12,
      y: 18,
      button: 'left',
    })
    expect(sendCommand).not.toHaveBeenCalledWith('Page.getFrameTree')

    const timeline = await controller.run(page, 'inspect', async (context) =>
      context.actionTimeline(),
    )
    expect(timeline[0]).toMatchObject({ action: 'click', status: 'interrupted' })
  })
})
