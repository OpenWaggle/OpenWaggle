import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import type { WebContents } from 'electron'
import { vi } from 'vitest'
import type { BrowserPreviewAutomationNavigationOperation } from '../browser-preview-automation-navigation'

export function navigationContents() {
  const events = new EventEmitter()
  let currentUrl = ''
  const contents = fromPartial<WebContents>({
    getURL: () => currentUrl,
    isDestroyed: () => false,
    on: events.on.bind(events),
    removeListener: events.removeListener.bind(events),
    stop: vi.fn(),
  })
  return {
    contents,
    events,
    setCurrentUrl(url: string) {
      currentUrl = url
    },
  }
}

export function navigationOperation(): {
  readonly operation: BrowserPreviewAutomationNavigationOperation
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly supersede: () => void
} {
  let current = true
  let resolve: (() => void) | undefined
  let reject: ((error: Error) => void) | undefined
  const completion = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return {
    operation: {
      generation: 1,
      completion,
      isCurrent: () => current,
      stop: vi.fn(),
    },
    resolve: () => resolve?.(),
    reject: (error: Error) => reject?.(error),
    supersede: () => {
      current = false
    },
  }
}
