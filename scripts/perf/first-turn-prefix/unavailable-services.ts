import * as Effect from 'effect/Effect'
import type { OpenWaggleDocsToolServices } from '../../../src/main/adapters/pi/openwaggle-docs-tool-extension'
import type { ProjectActionToolServices } from '../../../src/main/adapters/pi/project-actions-tool-extension'
import type { BrowserPreviewAutomationServiceShape } from '../../../src/main/ports/browser-preview-automation-service'

/**
 * Host services a measured Run never calls. Tools are only declared while the first-turn prefix is
 * captured, so every service fails if a tool were executed anyway.
 */
function unavailable() {
  return Effect.fail(new Error('Not available while measuring the first-turn prefix.'))
}

export const UNAVAILABLE_BROWSER_PREVIEW_SERVICE = {
  status: unavailable,
  open: unavailable,
  navigate: unavailable,
  resize: unavailable,
  setAppearance: unavailable,
  snapshot: unavailable,
  click: unavailable,
  type: unavailable,
  press: unavailable,
  scroll: unavailable,
  evaluate: unavailable,
  waitFor: unavailable,
  startRecording: unavailable,
  stopRecording: unavailable,
} satisfies BrowserPreviewAutomationServiceShape

export const UNAVAILABLE_PROJECT_ACTION_SERVICES = {
  catalog: {
    read: unavailable,
    edit: unavailable,
    restorePreparationReview: unavailable,
    discover: unavailable,
  },
  runs: {
    start: unavailable,
    list: unavailable,
    output: unavailable,
    stop: unavailable,
    stopWorkspaceRuns: unavailable,
    stopWorkspaceServices: unavailable,
    cleanupDeletedWorkspaces: unavailable(),
    withWorkspaceMutation: (_workspaceId, operation) => operation,
    recoverAfterHostLoss: unavailable(),
  },
  workspaces: { getBound: () => Effect.succeed(null) },
} satisfies ProjectActionToolServices

/** The docs services of a packaged app whose installed docs bundle is at `bundlePath`. */
export function installedDocsServices(bundlePath: string) {
  return {
    bundlePath: () => Effect.succeed(bundlePath),
    availableBundlePath: () => Effect.succeed(bundlePath),
    discover: unavailable,
  } satisfies OpenWaggleDocsToolServices
}
