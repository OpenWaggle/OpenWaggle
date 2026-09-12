import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

export const OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE = 'openwaggle-run-boundary'

/** Persists a non-model boundary so every later Pi entry can be attributed to its exact Run. */
export function createRunAttributionExtension(runId: string): ExtensionFactory {
  return (pi) => {
    pi.on('session_start', () => {
      pi.appendEntry(OPENWAGGLE_RUN_BOUNDARY_CUSTOM_TYPE, { version: 1, runId })
    })
  }
}
