import { SessionId } from '@shared/types/brand'
import type {
  DesktopCommandEnvelope,
  DesktopFenceRecord,
  DesktopServiceCommand,
} from '@shared/types/desktop-service'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../ports/browser-preview-automation-service'
import type { TerminalServiceShape } from '../../ports/terminal-service'
import { makeGuiDesktopServiceExecutor } from '../gui-desktop-service-executor'

export const browserStatus = {
  available: false,
  visible: false,
  tabId: null,
  url: null,
  title: null,
  loading: false,
  viewport: null,
  appearance: null,
}
export const browserCommand = {
  service: 'browser' as const,
  operation: 'status' as const,
  scope: { sessionId: SessionId('session-one'), workingPath: '/repo/worktree' },
  input: {},
}
export const activeFence: DesktopFenceRecord = {
  token: 'fence-one',
  hostInstanceId: 'host-one',
  scope: { kind: 'owner', ownerKey: 'session-one' },
  state: 'active',
}

export function envelope(
  command: DesktopServiceCommand = browserCommand,
  commandId = 'command-one',
): DesktopCommandEnvelope {
  return { commandId, leaseId: 'lease-one', deadline: Date.now() + 60_000, command }
}

export function executorHarness(
  options: {
    readonly acquireGate?: Effect.Effect<void, Error>
    readonly browser?: Partial<BrowserPreviewAutomationServiceShape>
    readonly releaseBrowser?: () => void
  } = {},
) {
  const nativeActive = new Set<string>()
  const nativeEvents: string[] = []
  const runWithMutationFence: TerminalServiceShape['runWithMutationFence'] = (scope, operation) =>
    Effect.zipRight(
      options.acquireGate ?? Effect.void,
      Effect.acquireUseRelease(
        Effect.sync(() => {
          const key = JSON.stringify(scope)
          nativeEvents.push(`acquire:${key}`)
          nativeActive.add(key)
          return key
        }),
        () => operation,
        (key) =>
          Effect.sync(() => {
            nativeEvents.push(`release:${key}`)
            nativeActive.delete(key)
          }),
      ),
    )
  const status = vi.fn(() => Effect.succeed(browserStatus))
  const browser: BrowserPreviewAutomationServiceShape = fromPartial({ status, ...options.browser })
  const deleteBrowserOwner = vi.fn(async () => undefined)
  const executor = makeGuiDesktopServiceExecutor({
    terminal: fromPartial({ runWithMutationFence }),
    browser,
    deleteBrowserOwner,
    acquireBrowserMutationFence: async () => options.releaseBrowser ?? (() => undefined),
  })
  return { executor, nativeActive, nativeEvents, browser, status, deleteBrowserOwner }
}
