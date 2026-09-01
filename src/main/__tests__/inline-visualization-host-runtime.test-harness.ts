import vm from 'node:vm'
import { vi } from 'vitest'
import hostRuntime from '../inline-visualization-assets/host-runtime.js.raw?raw'

export interface RuntimeWindow {
  readonly openai?: {
    readonly sendFollowUpMessage: (message: string) => Promise<boolean>
    readonly setVisualizationState: (state: unknown) => boolean
  }
}

interface RuntimeEvent {
  readonly source?: unknown
  readonly data?: unknown
  readonly isTrusted?: boolean
  readonly key?: string
}

export function runtimeHarness(
  nativeActivationIsActive = false,
  supportsLongTaskAccounting = true,
) {
  const postedMessages: unknown[] = []
  const listeners = new Map<string, Array<(event: RuntimeEvent) => void>>()
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
  const animationFrameCallbacks: Array<() => void> = []
  const mutationObserverCallbacks: Array<() => void> = []
  const mutationObserverOptions: unknown[] = []
  const resizeObserverCallbacks: Array<() => void> = []
  class RuntimePerformanceObserver {
    static supportedEntryTypes = ['longtask']

    constructor(callback: (list: { getEntries: () => Array<{ duration: number }> }) => void) {
      performanceObserverCallbacks.push(callback)
    }

    observe() {}
  }
  class RuntimePerformanceEntry {
    constructor(private readonly durationValue: number) {}

    get duration() {
      return this.durationValue
    }
  }
  class RuntimeMutationObserver {
    constructor(callback: () => void) {
      mutationObserverCallbacks.push(callback)
    }

    observe(_target: unknown, options: unknown) {
      mutationObserverOptions.push(options)
    }
  }
  class RuntimeResizeObserver {
    constructor(callback: () => void) {
      resizeObserverCallbacks.push(callback)
    }

    observe() {}
  }
  class RuntimePerformanceObserverEntryList {
    constructor(private readonly entries: RuntimePerformanceEntry[]) {}

    getEntries() {
      return this.entries
    }
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
      querySelector: vi.fn(() => null),
    },
    navigator,
    window: runtimeWindow,
    Element: class Element {},
    HTMLAnchorElement: class HTMLAnchorElement {},
    matchMedia: vi.fn(() => ({ matches: false })),
    addEventListener: vi.fn((type: string, listener: (event: RuntimeEvent) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    }),
    setTimeout,
    clearTimeout,
    queueMicrotask,
    requestAnimationFrame: (callback: () => void) => {
      animationFrameCallbacks.push(callback)
      return animationFrameCallbacks.length
    },
    MutationObserver: RuntimeMutationObserver,
    ResizeObserver: RuntimeResizeObserver,
    PerformanceObserver: supportsLongTaskAccounting ? RuntimePerformanceObserver : undefined,
    PerformanceEntry: RuntimePerformanceEntry,
    PerformanceObserverEntryList: RuntimePerformanceObserverEntryList,
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
  const dispatchWindowEvent = (type: string, event: RuntimeEvent = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  const dispatchSyntheticDocumentEvent = (type: string, fragmentHandler: () => void) => {
    for (const listener of documentListeners.get(type) ?? []) listener({ isTrusted: false })
    fragmentHandler()
  }
  const dispatchLongTasks = (...durations: number[]) => {
    for (const callback of performanceObserverCallbacks) {
      callback(
        new RuntimePerformanceObserverEntryList(
          durations.map((duration) => new RuntimePerformanceEntry(duration)),
        ),
      )
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
    dispatchMutations: () => {
      for (const callback of mutationObserverCallbacks) callback()
    },
    dispatchResize: () => {
      for (const callback of resizeObserverCallbacks) callback()
    },
    dispatchSyntheticDocumentEvent,
    dispatchTrustedDocumentEvent,
    flushAnimationFrames: () => {
      for (const callback of animationFrameCallbacks.splice(0)) callback()
    },
    navigator,
    mutationObserverOptions,
    postedMessages,
    runtimeWindow,
  }
}
