import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import hostRuntime from '../inline-visualization-assets/host-runtime.js.raw?raw'

interface RuntimeWindow {
  readonly openai?: {
    readonly sendFollowUpMessage: (message: string) => Promise<boolean>
  }
}

function runtimeHarness(nativeActivationIsActive = false, supportsLongTaskAccounting = true) {
  const postedMessages: unknown[] = []
  const listeners = new Map<string, Array<(event: { source?: unknown; data?: unknown }) => void>>()
  const documentListeners = new Map<string, Array<(event: { isTrusted?: boolean }) => void>>()
  const parent = { postMessage: (message: unknown) => postedMessages.push(message) }
  class NativeUserActivation {
    get isActive() {
      return nativeActivationIsActive
    }
  }
  const navigator: { userActivation: { readonly isActive: boolean } } = {
    userActivation: new NativeUserActivation(),
  }
  const runtimeWindow: RuntimeWindow = {}
  let performanceNow = 0
  const performanceObserverCallbacks: Array<
    (list: { getEntries: () => Array<{ duration: number }> }) => void
  > = []
  class RuntimePerformanceObserver {
    static supportedEntryTypes = ['longtask']

    constructor(callback: (list: { getEntries: () => Array<{ duration: number }> }) => void) {
      performanceObserverCallbacks.push(callback)
    }

    observe() {}
  }
  const context = vm.createContext({
    crypto: { randomUUID: vi.fn(() => 'trusted-capability-1234567890') },
    parent,
    document: {
      body: {
        children: [],
        getBoundingClientRect: () => ({ bottom: 0, top: 0 }),
      },
      addEventListener: vi.fn(
        (type: string, listener: (event: { isTrusted?: boolean }) => void) => {
          documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener])
        },
      ),
    },
    navigator,
    window: runtimeWindow,
    Element: class Element {},
    HTMLAnchorElement: class HTMLAnchorElement {},
    matchMedia: vi.fn(() => ({ matches: false })),
    addEventListener: vi.fn(
      (type: string, listener: (event: { source?: unknown; data?: unknown }) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      },
    ),
    setTimeout,
    clearTimeout,
    queueMicrotask,
    PerformanceObserver: supportsLongTaskAccounting ? RuntimePerformanceObserver : undefined,
    performance: { now: () => performanceNow },
  })
  vm.runInContext(hostRuntime, context)
  const dispatchHostMessage = (data: unknown) => {
    for (const listener of listeners.get('message') ?? []) listener({ source: parent, data })
  }
  const dispatchTrustedDocumentEvent = (type: string, fragmentHandler: () => void) => {
    for (const listener of documentListeners.get(type) ?? []) listener({ isTrusted: true })
    fragmentHandler()
  }
  const dispatchWindowEvent = (type: string) => {
    for (const listener of listeners.get(type) ?? []) listener({})
  }
  const dispatchSyntheticDocumentEvent = (type: string, fragmentHandler: () => void) => {
    for (const listener of documentListeners.get(type) ?? []) listener({ isTrusted: false })
    fragmentHandler()
  }
  const dispatchLongTasks = (...durations: number[]) => {
    for (const callback of performanceObserverCallbacks) {
      callback({ getEntries: () => durations.map((duration) => ({ duration })) })
    }
  }
  return {
    advanceRuntimeTime: (milliseconds: number) => {
      performanceNow += milliseconds
    },
    context,
    dispatchWindowEvent,
    dispatchHostMessage,
    dispatchLongTasks,
    dispatchSyntheticDocumentEvent,
    dispatchTrustedDocumentEvent,
    navigator,
    postedMessages,
    runtimeWindow,
  }
}

describe('inline visualization host runtime', () => {
  it('does not report readiness until fragment parsing reaches DOMContentLoaded', () => {
    const { dispatchWindowEvent, postedMessages } = runtimeHarness()

    expect(postedMessages).toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:bootstrap' }),
    )
    expect(postedMessages).not.toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:ready' }),
    )
    dispatchWindowEvent('DOMContentLoaded')
    expect(postedMessages).toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:ready' }),
    )
  })

  it('rejects a follow-up when fragment code shadows navigator.userActivation', async () => {
    const { navigator, postedMessages, runtimeWindow } = runtimeHarness()
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      value: { isActive: true },
    })

    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')
    await expect(openai.sendFollowUpMessage('Untrusted automatic follow-up')).resolves.toBe(false)
    expect(postedMessages).not.toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:follow-up' }),
    )
  })

  it('allows a follow-up during genuine native user activation', async () => {
    const { dispatchHostMessage, dispatchTrustedDocumentEvent, postedMessages, runtimeWindow } =
      runtimeHarness(true)
    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')

    let result: Promise<boolean> | undefined
    dispatchTrustedDocumentEvent('click', () => {
      result = openai.sendFollowUpMessage('Trusted interactive follow-up')
    })
    if (!result) throw new Error('Expected a follow-up result promise.')
    const request = postedMessages.find(
      (message): message is { capability: string; requestId: string; type: string } =>
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'openwaggle:inline-visualization:follow-up',
    )
    expect(request).toBeDefined()
    dispatchHostMessage({
      type: 'openwaggle:inline-visualization:follow-up-result',
      requestId: request?.requestId,
      accepted: true,
    })

    await expect(result).resolves.toBe(true)
  })

  it('rejects inherited native activation without a trusted event inside the frame', async () => {
    const { postedMessages, runtimeWindow } = runtimeHarness(true)
    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')

    await expect(openai.sendFollowUpMessage('Inherited activation attack')).resolves.toBe(false)
    expect(postedMessages).not.toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:follow-up' }),
    )
  })

  it('rejects synthetic and delayed calls outside trusted frame-event dispatch', async () => {
    const { dispatchSyntheticDocumentEvent, dispatchTrustedDocumentEvent, runtimeWindow } =
      runtimeHarness(true)
    const openai = runtimeWindow.openai
    if (!openai) throw new Error('Expected the trusted runtime API.')

    let syntheticResult: Promise<boolean> | undefined
    dispatchSyntheticDocumentEvent('click', () => {
      syntheticResult = openai.sendFollowUpMessage('Synthetic event attack')
    })
    if (!syntheticResult) throw new Error('Expected a synthetic-event result promise.')
    await expect(syntheticResult).resolves.toBe(false)

    dispatchTrustedDocumentEvent('click', () => undefined)
    await Promise.resolve()
    await expect(openai.sendFollowUpMessage('Delayed event attack')).resolves.toBe(false)
  })

  it('reports a resource limit when long tasks exceed the trusted runtime budget', () => {
    const { dispatchLongTasks, postedMessages } = runtimeHarness()

    dispatchLongTasks(600, 600)

    expect(postedMessages).toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:resource-limit' }),
    )
  })

  it('fails closed when browser long-task accounting is unavailable', () => {
    const { postedMessages } = runtimeHarness(false, false)

    expect(postedMessages.slice(0, 2)).toEqual([
      expect.objectContaining({ type: 'openwaggle:inline-visualization:bootstrap' }),
      expect.objectContaining({ type: 'openwaggle:inline-visualization:resource-limit' }),
    ])
  })

  it('measures the resource budget over a rolling window', () => {
    const { advanceRuntimeTime, dispatchLongTasks, postedMessages } = runtimeHarness()

    dispatchLongTasks(600)
    advanceRuntimeTime(5_001)
    dispatchLongTasks(600)

    expect(postedMessages).not.toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:resource-limit' }),
    )
  })

  it('keeps resource accounting independent from fragment-patched intrinsics', () => {
    const { context, dispatchLongTasks, postedMessages } = runtimeHarness()
    vm.runInContext(
      `Array.prototype.push = () => 0;
       Array.prototype.shift = () => undefined;
       Array.prototype.reduce = () => 0;
       Number.isFinite = () => false;`,
      context,
    )

    dispatchLongTasks(600, 600)

    expect(postedMessages).toContainEqual(
      expect.objectContaining({ type: 'openwaggle:inline-visualization:resource-limit' }),
    )
  })
})
