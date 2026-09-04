type FrameMessageHandler = (event: MessageEvent<unknown>) => void

interface FrameSubscription {
  readonly origin: string
  readonly handler: FrameMessageHandler
}

const frameSubscriptions = new Map<MessageEventSource, FrameSubscription>()
const themeSubscribers = new Set<() => void>()
let themeObserver: MutationObserver | null = null

function receiveMessage(event: MessageEvent<unknown>) {
  if (!event.source) return
  const subscription = frameSubscriptions.get(event.source)
  if (!subscription || event.origin !== subscription.origin) return
  subscription.handler(event)
}

function ensureMessageListener() {
  if (frameSubscriptions.size === 0) window.addEventListener('message', receiveMessage)
}

export function subscribeInlineVisualizationFrame(
  frameWindow: Window,
  origin: string,
  handler: FrameMessageHandler,
) {
  ensureMessageListener()
  frameSubscriptions.set(frameWindow, { origin, handler })
  return () => {
    frameSubscriptions.delete(frameWindow)
    if (frameSubscriptions.size === 0) window.removeEventListener('message', receiveMessage)
  }
}

export function subscribeInlineVisualizationTheme(subscriber: () => void) {
  if (themeSubscribers.size === 0) {
    themeObserver = new MutationObserver(() => {
      for (const notify of themeSubscribers) notify()
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme', 'data-motion'],
    })
  }
  themeSubscribers.add(subscriber)
  return () => {
    themeSubscribers.delete(subscriber)
    if (themeSubscribers.size === 0) {
      themeObserver?.disconnect()
      themeObserver = null
    }
  }
}
