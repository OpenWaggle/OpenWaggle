import { beforeEach, describe, expect, it } from 'vitest'
import { BrowserPreviewAutomationController } from '../browser-preview-automation-control'
import { createBrowserPreviewAutomationPageFixture as createPage } from './browser-preview-automation-control-test-harness'

describe('browser preview automation controller interruption', () => {
  let controller: BrowserPreviewAutomationController

  beforeEach(() => {
    controller = new BrowserPreviewAutomationController()
  })

  it('interrupts an in-flight action when the human takes control', async () => {
    const { page, contentsEvents } = createPage()

    await expect(
      controller.run(page, 'click', async (context) => {
        await context.send('Page.getFrameTree')
        contentsEvents.emit('before-mouse-event', {}, {})
        await context.send('Page.getFrameTree')
      }),
    ).rejects.toThrow('interrupted by human input')

    const timeline = await controller.run(page, 'inspect', async (context) =>
      context.actionTimeline(),
    )
    expect(timeline[0]).toMatchObject({ action: 'click', status: 'interrupted' })
  })

  it('does not report success when human input arrives after the final CDP command', async () => {
    const { page, contentsEvents } = createPage()

    await expect(
      controller.run(page, 'click', async (context) => {
        await context.send('Page.getFrameTree')
        contentsEvents.emit('before-mouse-event', {}, {})
      }),
    ).rejects.toThrow('interrupted by human input')

    const timeline = await controller.run(page, 'inspect', async (context) =>
      context.actionTimeline(),
    )
    expect(timeline[0]).toMatchObject({ action: 'click', status: 'interrupted' })
  })

  it('interrupts an in-flight action before it can continue in a replacement document', async () => {
    const { page, contentsEvents, sendCommand } = createPage()

    await expect(
      controller.run(page, 'click', async (context) => {
        await context.send('Page.getFrameTree')
        contentsEvents.emit(
          'did-start-navigation',
          {},
          'https://example.com/replacement',
          false,
          true,
        )
        await context.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: 12,
          y: 18,
          button: 'left',
        })
      }),
    ).rejects.toThrow('interrupted by page navigation')

    expect(sendCommand).not.toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed' }),
    )
    const timeline = await controller.run(page, 'inspect', async (context) =>
      context.actionTimeline(),
    )
    expect(timeline[0]).toMatchObject({ action: 'click', status: 'interrupted' })
  })

  it('keeps an action valid across subframe and same-document navigation', async () => {
    const { page, contentsEvents } = createPage()

    await expect(
      controller.run(page, 'inspect', async (context) => {
        await context.send('Page.getFrameTree')
        contentsEvents.emit('did-start-navigation', {}, 'https://example.com/frame', false, false)
        contentsEvents.emit(
          'did-start-navigation',
          {},
          'https://example.com/page#section',
          true,
          true,
        )
        return context.send('Page.getFrameTree')
      }),
    ).resolves.toEqual({})
  })

  it('interrupts when Chromium clears execution contexts without a navigation event', async () => {
    const { page, debuggerEvents } = createPage()

    await expect(
      controller.run(page, 'evaluate', async (context) => {
        await context.send('Runtime.enable')
        debuggerEvents.emit('message', {}, 'Runtime.executionContextsCleared', {}, '')
        return context.evaluate('answer')
      }),
    ).rejects.toThrow('interrupted by page navigation')
  })

  it('distinguishes delayed agent input from interleaved human input', async () => {
    const { page, contentsEvents } = createPage()

    await expect(
      controller.run(page, 'click', async (context) => {
        await context.dispatchInput('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x: 12,
          y: 18,
          button: 'left',
        })
        contentsEvents.emit(
          'before-mouse-event',
          {},
          {
            type: 'mouseDown',
            x: 40,
            y: 18,
            button: 'left',
            modifiers: [],
          },
        )
        contentsEvents.emit(
          'before-mouse-event',
          {},
          {
            type: 'mouseDown',
            x: 12,
            y: 18,
            button: 'left',
            modifiers: [],
          },
        )
        await context.send('Page.getFrameTree')
      }),
    ).rejects.toThrow('interrupted by human input')
  })

  it('accepts an exact agent input event delivered after its CDP command resolves', async () => {
    const { page, contentsEvents } = createPage()

    await controller.run(page, 'click', async (context) => {
      await context.dispatchInput('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: 12,
        y: 18,
        button: 'left',
      })
      contentsEvents.emit(
        'before-mouse-event',
        {},
        {
          type: 'mouseDown',
          x: 12,
          y: 18,
          button: 'left',
          modifiers: [],
        },
      )
      await context.send('Page.getFrameTree')
    })
  })
})
