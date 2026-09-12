import type { BrowserPreviewControllerState } from '@shared/types/browser-preview'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewAutomationController } from '../browser-preview-automation-control'
import { browserPreviewAutomationPage } from '../browser-preview-automation-page'
import { BrowserPreviewControlOperations } from '../browser-preview-control-operations'
import type { BrowserPreviewRecord } from '../browser-preview-records'
import { createBrowserPreviewAutomationPageFixture as createPage } from './browser-preview-automation-control-test-harness'

describe('browser preview automation controller', () => {
  let controller: BrowserPreviewAutomationController

  beforeEach(() => {
    controller = new BrowserPreviewAutomationController()
  })

  it('serializes every action targeting the same tab', async () => {
    const { page } = createPage()
    let releaseFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const order: string[] = []
    const first = controller.run(page, 'first', async () => {
      order.push('first-start')
      await firstBlocked
      order.push('first-end')
    })
    const second = controller.run(page, 'second', async () => {
      order.push('second')
    })

    await vi.waitFor(() => expect(order).toEqual(['first-start']))
    releaseFirst?.()
    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('shares one serialized CDP session with user appearance controls and releases it once', async () => {
    const { page, sendCommand } = createPage()
    const record = fromPartial<BrowserPreviewRecord>({
      previewId: 'preview-1',
      owner: { sender: fromPartial<WebContents>({ id: 42 }) },
      view: { webContents: page.contents },
    })
    const canonicalPage = browserPreviewAutomationPage(record)
    const controls = new BrowserPreviewControlOperations(controller)

    await Promise.all([
      controls.setAppearance(canonicalPage.tabId, canonicalPage.contents, 'dark'),
      controller.run(canonicalPage, 'page-action', (context) => context.send('Page.getFrameTree')),
    ])

    expect(canonicalPage.tabId).toBe('42:preview-1')
    expect(page.contents.debugger.attach).toHaveBeenCalledOnce()
    expect(sendCommand.mock.calls.map(([method]) => method)).toEqual(
      expect.arrayContaining(['Emulation.setEmulatedMedia', 'Page.getFrameTree']),
    )

    controls.dispose(canonicalPage.tabId)
    expect(page.contents.debugger.detach).toHaveBeenCalledOnce()
  })

  it('evaluates through a lazily initialized CDP session', async () => {
    const { page, sendCommand } = createPage()

    const result = await controller.run(page, 'evaluate', (context) => context.evaluate('answer'))

    expect(result).toBe(42)
    expect(sendCommand).toHaveBeenCalledWith('Runtime.enable')
    expect(sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({ expression: 'answer', returnByValue: true }),
    )
  })

  it('pins the Electron debugger wrapper for the complete control-session lifetime', async () => {
    const { page, browserDebugger } = createPage()
    let debuggerReads = 0
    Object.defineProperty(page.contents, 'debugger', {
      configurable: true,
      get() {
        debuggerReads += 1
        if (debuggerReads > 1) throw new Error('WebContents.debugger was dereferenced again.')
        return browserDebugger
      },
    })

    await controller.run(page, 'inspect', (context) => context.send('Page.getFrameTree'))
    controller.dispose(page.tabId)

    expect(debuggerReads).toBe(1)
    expect(browserDebugger.detach).toHaveBeenCalledOnce()
  })

  it('publishes agent control, pointer movement, and the return to human control', async () => {
    const fixture = createPage()
    const states: BrowserPreviewControllerState[] = []
    const page = {
      ...fixture.page,
      onControllerChange: (state: BrowserPreviewControllerState) => states.push(state),
    }

    await controller.run(page, 'click', (context) =>
      context.dispatchInput('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 24,
        y: 42,
      }),
    )

    expect(states).toEqual([
      { kind: 'agent', action: 'click', pointer: null },
      { kind: 'agent', action: 'click', pointer: { x: 24, y: 42 } },
      { kind: 'human' },
    ])
  })

  it('rejects automation while DevTools owns the preview debugging surface', async () => {
    const { page } = createPage({ devToolsOpen: true })

    await expect(
      controller.run(page, 'inspect', (context) => context.send('Page.getFrameTree')),
    ).rejects.toThrow('Close DevTools')
    expect(page.contents.debugger.attach).not.toHaveBeenCalled()
  })

  it('rejects a later action if DevTools opens after the controller attached', async () => {
    const { page, openDevTools } = createPage()
    await controller.run(page, 'inspect', (context) => context.send('Page.getFrameTree'))
    openDevTools()

    await expect(
      controller.run(page, 'inspect-again', (context) => context.send('Page.getFrameTree')),
    ).rejects.toThrow('Close DevTools')
    expect(page.contents.debugger.attach).toHaveBeenCalledOnce()
  })

  it('rejects automation when another client already attached the debugger', async () => {
    const { page } = createPage({ attached: true })

    await expect(
      controller.run(page, 'inspect', (context) => context.send('Page.getFrameTree')),
    ).rejects.toThrow('another debugger is attached. Disconnect it and retry')
    expect(page.contents.debugger.attach).not.toHaveBeenCalled()
    expect(page.contents.debugger.detach).not.toHaveBeenCalled()
  })

  it('normalizes a debugger attachment race into an actionable conflict', async () => {
    const { page, setDebuggerAttached } = createPage()
    vi.mocked(page.contents.debugger.attach).mockImplementationOnce(() => {
      setDebuggerAttached(true)
      throw new Error('Another debugger attached first')
    })

    await expect(
      controller.run(page, 'inspect', (context) => context.send('Page.getFrameTree')),
    ).rejects.toThrow('another debugger is attached. Disconnect it and retry')
    expect(page.contents.debugger.detach).not.toHaveBeenCalled()
  })

  it('times out a stuck CDP command and advances the per-tab queue', async () => {
    const { page, sendCommand } = createPage()
    sendCommand.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate') return new Promise<never>(() => undefined)
      return {}
    })

    const stuck = controller.run(page, 'stuck', (context) => context.evaluate('never'), {
      timeoutMs: 25,
    })
    await expect(stuck).rejects.toThrow('timed out within 25 ms')
    sendCommand.mockResolvedValue({})

    await expect(
      controller.run(page, 'next', (context) => context.send('Page.getFrameTree')),
    ).resolves.toEqual({})
  })

  it('bounds an arbitrary action promise and advances the per-tab queue', async () => {
    const { page } = createPage()
    let started = false
    const stuck = controller.run(
      page,
      'native-operation',
      async () => {
        started = true
        return new Promise<never>(() => undefined)
      },
      { timeoutMs: 25 },
    )
    const rejection = expect(stuck).rejects.toThrow('timed out within 25 ms')
    await vi.waitFor(() => expect(started).toBe(true))

    await rejection
    await expect(
      controller.run(page, 'next', (context) => context.send('Page.getFrameTree')),
    ).resolves.toEqual({})
  })

  it('does not let a timed-out queued action bypass the active action', async () => {
    const { page } = createPage()
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const order: string[] = []
    const first = controller.run(page, 'first', async () => {
      order.push('first-start')
      await gate
      order.push('first-end')
    })
    const queued = controller.run(
      page,
      'queued',
      async () => {
        order.push('queued')
      },
      { timeoutMs: 25 },
    )

    await expect(queued).rejects.toThrow('timed out within 25 ms')
    const third = controller.run(page, 'third', async () => {
      order.push('third')
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(order).toEqual(['first-start'])

    releaseFirst?.()
    await Promise.all([first, third])
    expect(order).toEqual(['first-start', 'first-end', 'third'])
  })

  it('rejects a cancelled queued action before the active action releases', async () => {
    const { page } = createPage()
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const first = controller.run(page, 'first', () => gate)
    const cancellation = new AbortController()
    const queued = controller.run(page, 'queued', async () => undefined, {
      signal: cancellation.signal,
    })

    cancellation.abort()
    await expect(queued).rejects.toThrow('cancelled')
    releaseFirst?.()
    await first
  })

  it('returns a rejected promise when the page is already destroyed during setup', async () => {
    const { page, destroy } = createPage()
    destroy()
    let pending: Promise<void> | undefined

    expect(() => {
      pending = controller.run(page, 'inspect', async () => undefined)
    }).not.toThrow()
    await expect(pending).rejects.toThrow('destroyed')
  })

  it('records and cleans up background-throttling setup failures', async () => {
    const { page } = createPage()
    const use = vi.fn(async () => undefined)
    vi.mocked(page.contents.setBackgroundThrottling).mockImplementationOnce(() => {
      throw new Error('background throttling failed')
    })

    await expect(controller.run(page, 'setup-failure', use)).rejects.toThrow(
      'background throttling failed',
    )
    expect(use).not.toHaveBeenCalled()

    const timeline = await controller.run(page, 'inspect', async (context) =>
      context.actionTimeline(),
    )
    expect(timeline[0]).toMatchObject({ action: 'setup-failure', status: 'failed' })
  })

  it('makes owned-debugger teardown best-effort when Electron detachment races', async () => {
    const { page } = createPage()
    await controller.run(page, 'inspect', (context) => context.send('Page.getFrameTree'))
    vi.mocked(page.contents.debugger.detach).mockImplementationOnce(() => {
      throw new Error('target disappeared')
    })

    expect(() => controller.dispose(page.tabId)).not.toThrow()
  })

  it('collects bounded CDP diagnostics for snapshots', async () => {
    const { page, debuggerEvents } = createPage()
    const diagnostics = await controller.run(page, 'inspect', async (context) => {
      await context.send('Runtime.enable')
      debuggerEvents.emit(
        'message',
        {},
        'Runtime.consoleAPICalled',
        { type: 'log', args: [{ value: 'ready' }], timestamp: 1_725_000_000 },
        '',
      )
      return context.consoleEntries()
    })

    expect(diagnostics).toEqual([expect.objectContaining({ level: 'log', text: 'ready' })])
  })
})
