import type { BrowserEngineStatus } from '@shared/types/browser-engine'
import { CefComponentError } from './cef-component-download'
import {
  ensureCefComponent,
  type CefComponentInstallerDependencies,
} from './cef-component-installer'
import { createLogger } from '../../../logger'
import type { BrowserEngineShape } from '../../../ports/desktop-shell/browser-engine'

const logger = createLogger('browser-engine')

const READY: BrowserEngineStatus = { type: 'ready' }

function failureOf(error: unknown) {
  if (error instanceof CefComponentError) {
    return {
      type: 'failed',
      reason: error.reason,
      message: error.message,
    } satisfies BrowserEngineStatus
  }
  const detail = error instanceof Error ? error.message : String(error)
  return {
    type: 'failed',
    reason: 'install',
    message: `The browser engine could not be installed: ${detail}`,
  } satisfies BrowserEngineStatus
}

/**
 * The CEF component as the app's BrowserEngine: one install in flight however many callers ask,
 * its progress as status changes, and a retry on the next `ensure()` after a failure.
 */
export function createCefComponentEngine(dependencies: CefComponentInstallerDependencies) {
  let status: BrowserEngineStatus = dependencies.platform === 'darwin' ? { type: 'idle' } : READY
  let inFlight: Promise<BrowserEngineStatus> | null = null
  const listeners = new Set<(status: BrowserEngineStatus) => void>()

  const report = (next: BrowserEngineStatus) => {
    status = next
    for (const listener of listeners) listener(next)
  }

  const run = async () => {
    report({ type: 'checking' })
    try {
      await ensureCefComponent(dependencies, report)
      report(READY)
    } catch (error) {
      logger.warn('The browser engine could not be made ready', { error })
      report(failureOf(error))
    }
    return status
  }

  return {
    status: () => status,
    ensure: () => {
      if (status.type === 'ready') return Promise.resolve(status)
      inFlight ??= run().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    onStatus: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  } satisfies BrowserEngineShape
}
