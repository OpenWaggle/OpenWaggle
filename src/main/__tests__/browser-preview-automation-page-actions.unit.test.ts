import { EventEmitter } from 'node:events'
import { BROWSER_PREVIEW_AUTOMATION_LIMITS } from '@shared/types/browser-preview-automation'
import { fromPartial } from '@total-typescript/shoehorn'
import type { Debugger, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  getFocusedWebContents: vi.fn(),
}))

vi.mock('electron', () => ({
  webContents: { getFocusedWebContents: electronMocks.getFocusedWebContents },
}))

const { BrowserPreviewAutomationController } = await import('../browser-preview-automation-control')
const {
  clickBrowserPreviewPage,
  evaluateBrowserPreviewPage,
  pressBrowserPreviewKey,
  typeIntoBrowserPreviewPage,
  waitForBrowserPreviewPage,
} = await import('../browser-preview-automation-page-actions')

type CommandHandler = (
  method: string,
  params?: Readonly<Record<string, unknown>>,
) => unknown | Promise<unknown>

function createPage(commandHandler: CommandHandler) {
  const contentsEvents = new EventEmitter()
  const debuggerEvents = new EventEmitter()
  let attached = false
  const focus = vi.fn()
  const sendCommand = vi.fn(
    async (method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> =>
      commandHandler(method, params),
  )
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
    focus,
    getBackgroundThrottling: () => true,
    isDevToolsOpened: () => false,
    isDestroyed: () => false,
    on: contentsEvents.on.bind(contentsEvents),
    once: contentsEvents.once.bind(contentsEvents),
    removeListener: contentsEvents.removeListener.bind(contentsEvents),
    setBackgroundThrottling: vi.fn(),
  })
  return {
    contentsEvents,
    focus,
    page: { tabId: 'tab-1', contents },
    sendCommand,
  }
}

function evaluated(value: unknown) {
  return { result: { value } }
}

beforeEach(() => {
  electronMocks.getFocusedWebContents.mockReset()
})

describe('browser preview automation page actions', () => {
  it('rejects evaluation output above the 64 KB result limit', async () => {
    const oversized = 'x'.repeat(BROWSER_PREVIEW_AUTOMATION_LIMITS.RESULT_BYTES + 1)
    const { page } = createPage((method) =>
      method === 'Runtime.evaluate' ? evaluated(oversized) : {},
    )
    const controller = new BrowserPreviewAutomationController()

    await expect(
      evaluateBrowserPreviewPage(controller, page, { expression: 'globalThis.payload' }),
    ).rejects.toThrow('evaluation result exceeded the 64 KB limit')
  })

  it('cancels a pending page wait without waiting for its timeout', async () => {
    const abortController = new AbortController()
    const { page, sendCommand } = createPage((method) =>
      method === 'Runtime.evaluate' ? evaluated({ kind: 'match', matched: false }) : {},
    )
    const controller = new BrowserPreviewAutomationController()
    const waiting = waitForBrowserPreviewPage(
      controller,
      page,
      { text: 'ready', timeoutMs: 5_000 },
      abortController.signal,
    )
    const rejection = expect(waiting).rejects.toThrow('Browser preview action was cancelled')

    await vi.waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(
        'Runtime.evaluate',
        expect.objectContaining({ returnByValue: true }),
      ),
    )
    abortController.abort()

    await rejection
  })

  it('reinstalls the locator runtime and continues waiting after document replacement', async () => {
    let runtimeChecks = 0
    let waitChecks = 0
    let navigate = () => undefined
    const { contentsEvents, page, sendCommand } = createPage((method, params) => {
      if (method !== 'Runtime.evaluate') return {}
      const expression = String(params?.expression ?? '')
      if (expression === 'Boolean(globalThis.__openWagglePlaywrightInjected)') {
        runtimeChecks += 1
        return evaluated(runtimeChecks === 1)
      }
      if (expression.includes("kind: 'match'")) {
        waitChecks += 1
        if (waitChecks === 1) queueMicrotask(navigate)
        return evaluated({ kind: 'match', matched: waitChecks > 1 })
      }
      return evaluated(true)
    })
    navigate = () => {
      contentsEvents.emit(
        'did-start-navigation',
        {},
        'https://example.com/replacement',
        false,
        true,
      )
    }

    await expect(
      waitForBrowserPreviewPage(new BrowserPreviewAutomationController(), page, {
        locator: 'role=button[name="Ready"]',
        timeoutMs: 1_000,
      }),
    ).resolves.toBeUndefined()

    expect(runtimeChecks).toBe(2)
    expect(waitChecks).toBe(2)
    expect(sendCommand).toHaveBeenCalledWith(
      'Runtime.evaluate',
      expect.objectContaining({
        expression: expect.stringContaining('__openWagglePlaywrightInjected'),
      }),
    )
  })

  it('releases a pressed mouse button when dispatch fails', async () => {
    const { page, sendCommand } = createPage((method, params) => {
      if (method === 'Runtime.evaluate') {
        return evaluated({ width: 800, height: 600 })
      }
      if (method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') {
        throw new Error('mouse dispatch failed')
      }
      return {}
    })
    const controller = new BrowserPreviewAutomationController()

    await expect(clickBrowserPreviewPage(controller, page, { x: 25, y: 30 })).rejects.toThrow(
      'mouse dispatch failed',
    )

    expect(sendCommand).toHaveBeenCalledWith('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 25,
      y: 30,
      button: 'left',
      clickCount: 1,
    })
    expect(sendCommand).toHaveBeenCalledWith('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 25,
      y: 30,
      button: 'left',
      clickCount: 1,
    })
  })

  it('retries a locator click until the target becomes actionable', async () => {
    let clickAttempts = 0
    const { page, sendCommand } = createPage((method, params) => {
      if (method !== 'Runtime.evaluate') return {}
      const expression = String(params?.expression ?? '')
      if (expression.includes('__openWagglePlaywrightInjected)')) return evaluated(true)
      if (expression.includes("kind: 'point'")) {
        clickAttempts += 1
        return evaluated(
          clickAttempts < 3 ? { kind: 'not-found' } : { kind: 'point', x: 40, y: 50 },
        )
      }
      return evaluated({ width: 800, height: 600 })
    })
    const controller = new BrowserPreviewAutomationController()

    await clickBrowserPreviewPage(controller, page, { selector: '#eventual', timeoutMs: 1_000 })

    expect(clickAttempts).toBe(3)
    expect(sendCommand).toHaveBeenCalledWith(
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', x: 40, y: 50 }),
    )
  })

  it('retries typing while a target is missing or disabled', async () => {
    let typeAttempts = 0
    const { page } = createPage((method, params) => {
      if (method !== 'Runtime.evaluate') return {}
      const expression = String(params?.expression ?? '')
      if (expression.includes('__openWagglePlaywrightInjected)')) return evaluated(true)
      typeAttempts += 1
      return evaluated(
        typeAttempts === 1
          ? { kind: 'not-found' }
          : typeAttempts === 2
            ? { kind: 'not-editable' }
            : { kind: 'ok' },
      )
    })
    const controller = new BrowserPreviewAutomationController()

    await typeIntoBrowserPreviewPage(controller, page, {
      selector: '#eventual-input',
      text: 'ready',
      timeoutMs: 1_000,
    })

    expect(typeAttempts).toBe(3)
  })

  it('releases a failed key press, restores focus emulation, and returns prior focus', async () => {
    const previousFocus = vi.fn()
    electronMocks.getFocusedWebContents.mockReturnValue(
      fromPartial<WebContents>({ id: 2, focus: previousFocus, isDestroyed: () => false }),
    )
    const { focus, page, sendCommand } = createPage((method, params) => {
      if (method === 'Input.dispatchKeyEvent' && params?.type !== 'keyUp') {
        throw new Error('key dispatch failed')
      }
      return {}
    })
    const controller = new BrowserPreviewAutomationController()

    await expect(pressBrowserPreviewKey(controller, page, { key: 'Enter' })).rejects.toThrow(
      'key dispatch failed',
    )

    expect(focus).toHaveBeenCalledOnce()
    expect(sendCommand).toHaveBeenCalledWith(
      'Input.dispatchKeyEvent',
      expect.objectContaining({ type: 'keyUp', key: 'Enter' }),
    )
    expect(sendCommand).toHaveBeenCalledWith('Emulation.setFocusEmulationEnabled', {
      enabled: false,
    })
    expect(previousFocus).toHaveBeenCalledOnce()
  })
})
