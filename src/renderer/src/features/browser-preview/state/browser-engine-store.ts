import type { BrowserEngineStatus } from '@shared/types/browser-engine'
import { create } from 'zustand'
import { api } from '@/shared/lib/ipc'
import { ipcFailureMessage } from '@/shared/lib/ipc-error-message'

interface BrowserEngineState {
  readonly status: BrowserEngineStatus
}

/** The Browser preview's engine as main reports it; previews open once it is `ready`. */
export const useBrowserEngineStore = create<BrowserEngineState>(() => ({
  status: { type: 'idle' },
}))

export function setBrowserEngineStatus(status: BrowserEngineStatus) {
  useBrowserEngineStore.setState({ status })
}

let pending: Promise<void> | null = null

/**
 * Asks main to install the engine if it is missing (a download on macOS). One request at a time;
 * progress arrives through `browser-engine:status-changed`. After a failure it is the retry.
 */
export function ensureBrowserEngine(): Promise<void> {
  if (useBrowserEngineStore.getState().status.type === 'ready') return Promise.resolve()
  pending ??= api
    .ensureBrowserEngine()
    .then(setBrowserEngineStatus, (error: unknown) =>
      setBrowserEngineStatus({
        type: 'failed',
        reason: 'install',
        message: ipcFailureMessage(error, 'The browser engine could not be installed.'),
      }),
    )
    .finally(() => {
      pending = null
    })
  return pending
}
