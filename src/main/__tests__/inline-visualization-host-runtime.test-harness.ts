import vm from 'node:vm'
import { vi } from 'vitest'
import hostRuntime from '../inline-visualization-assets/host-runtime.js.raw?raw'

export interface RuntimeWindow {
  readonly matchMedia?: (query: string) => {
    readonly matches: boolean
    onchange: ((event: { readonly matches: boolean }) => void) | null
    addEventListener: (
      type: string,
      listener:
        | ((event: { readonly matches: boolean }) => void)
        | { handleEvent: (event: { readonly matches: boolean }) => void },
      options?: boolean | AddEventListenerOptions,
    ) => void
  }
  readonly openai?: {
    readonly sendFollowUpMessage: (message: string) => Promise<boolean>
    readonly setVisualizationState: (state: unknown) => boolean
  }
}

interface RuntimeEvent {
  readonly source?: unknown
  readonly data?: unknown
  readonly isTrusted?: boolean
  readonly type?: string
  readonly key?: string
}

export function runtimeHarness(
  nativeActivationIsActive = false,
  supportsLongTaskAccounting = true,
  initialReducedMotion = false,
) {
  const postedMessages: unknown[] = []
  const rootStyleValues = new Map<string, string>()
  const rootDataset: Record<string, string> = {}
  if (initialReducedMotion) rootDataset.motion = 'reduced'
  const documentElement = {
    dataset: rootDataset,
    style: {
      colorScheme: '',
      setProperty: (name: string, value: string) => rootStyleValues.set(name, value),
    },
  }
  const listeners = new Map<string, Array<(event: RuntimeEvent) => void>>()
  const documentListeners = new Map<string, Array<(event: { isTrusted?: boolean }) => void>>()
  const parent = { postMessage: (message: unknown) => postedMessages.push(message) }
  const nativeEventTrust = new WeakMap<object, boolean>()
  let currentDocumentEvent: NativeDocumentEvent | null = null
  class NativeDocumentEvent extends Event {
    constructor(eventType: string, trusted = false) {
      super(eventType)
      nativeEventTrust.set(this, trusted)
      Object.defineProperty(this, 'isTrusted', {
        configurable: false,
        enumerable: true,
        get(this: object) {
          return nativeEventTrust.get(this) ?? false
        },
      })
    }

    declare readonly isTrusted: boolean
  }
  class NativeRuntimeWindow {
    declare readonly openai?: RuntimeWindow['openai']

    matchMedia(query: string) {
      return {
        addEventListener: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
      }
    }

    get event() {
      return currentDocumentEvent
    }
  }
  class NativeUserActivation {
    get isActive() {
      return nativeActivationIsActive
    }
  }
  const navigator: { userActivation: { readonly isActive: boolean } } = {
    userActivation: new NativeUserActivation(),
  }
  const runtimeWindow: RuntimeWindow = new NativeRuntimeWindow()
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
      documentElement,
      head: { append: vi.fn() },
      body: {
        children: [],
        getBoundingClientRect: () => ({ bottom: 0, top: 0 }),
      },
      addEventListener: vi.fn(
        (type: string, listener: (event: { isTrusted?: boolean }) => void) => {
          documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener])
        },
      ),
      createElement: vi.fn(() => ({ addEventListener: vi.fn() })),
      getElementById: vi.fn(() => null),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
    },
    navigator,
    window: runtimeWindow,
    Event: NativeDocumentEvent,
    EventTarget,
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
  const dispatchHostMessage = (data: unknown, isTrusted = true) => {
    for (const listener of listeners.get('message') ?? []) {
      listener({ source: parent, data, isTrusted })
    }
  }
  const dispatchTrustedDocumentEvent = (type: string, fragmentHandler: () => void) => {
    const event = new NativeDocumentEvent(type, true)
    currentDocumentEvent = event
    try {
      for (const listener of documentListeners.get(type) ?? []) listener(event)
      fragmentHandler()
    } finally {
      currentDocumentEvent = null
    }
  }
  const dispatchTrustedDocumentEventAfterMicrotask = async (
    type: string,
    fragmentHandler: () => void,
  ) => {
    const event = new NativeDocumentEvent(type, true)
    currentDocumentEvent = event
    for (const listener of documentListeners.get(type) ?? []) listener(event)
    currentDocumentEvent = null
    await Promise.resolve()
    currentDocumentEvent = event
    try {
      fragmentHandler()
    } finally {
      currentDocumentEvent = null
    }
  }
  const dispatchWindowEvent = (type: string, event: RuntimeEvent = {}) => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  const dispatchSyntheticDocumentEvent = (type: string, fragmentHandler: () => void) => {
    const event = new NativeDocumentEvent(type, false)
    currentDocumentEvent = event
    try {
      for (const listener of documentListeners.get(type) ?? []) listener(event)
      fragmentHandler()
    } finally {
      currentDocumentEvent = null
    }
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
    documentElement,
    dispatchWindowEvent,
    dispatchHostMessage,
    dispatchSyntheticHostMessage: (data: unknown) => dispatchHostMessage(data, false),
    dispatchLongTasks,
    dispatchMutations: () => {
      for (const callback of mutationObserverCallbacks) callback()
    },
    dispatchResize: () => {
      for (const callback of resizeObserverCallbacks) callback()
    },
    dispatchSyntheticDocumentEvent,
    dispatchTrustedDocumentEvent,
    dispatchTrustedDocumentEventAfterMicrotask,
    flushAnimationFrames: () => {
      for (const callback of animationFrameCallbacks.splice(0)) callback()
    },
    navigator,
    mutationObserverOptions,
    postedMessages,
    rootStyleValues,
    runtimeWindow,
  }
}
