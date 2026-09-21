import { promises as fs } from 'node:fs'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brokerHarness } from '../../../application/__tests__/desktop-service-broker.test-harness'
import type { BrowserPreviewAutomationServiceShape } from '../../../ports/browser-preview-automation-service'
import { startGuiDesktopServiceBridge } from '../../../session-host/gui-desktop-service-bridge'
import { makeGuiDesktopServiceExecutor } from '../../../session-host/gui-desktop-service-executor'
import type { LocalSessionHostPaths } from '../../../session-host/local-session-paths'
import {
  OWNER,
  open,
  service,
  settle,
  setupTerminalServiceActionsTest,
  spawn,
  teardownTerminalServiceActionsTest,
  workDirA,
} from './terminal-service-actions-test-harness'

vi.mock('../../../session-host/local-session-client', () => ({
  executeLocalSessionCommand: vi.fn(),
}))
vi.mock('../../../session-host/local-session-paths', () => ({
  refreshLocalSessionHostEndpoint: vi.fn(),
}))

describe('Host mutation completion and real terminal admission', () => {
  beforeEach(setupTerminalServiceActionsTest)
  afterEach(teardownTerminalServiceActionsTest)

  it('waits for native fence release before a completed mutation permits immediate terminal reopen', async () => {
    const instance = brokerHarness()
    const snapshotReached = Promise.withResolvers<void>()
    const allowReleaseSnapshot = Promise.withResolvers<void>()
    const executor = makeGuiDesktopServiceExecutor({
      terminal: service,
      browser: fromPartial<BrowserPreviewAutomationServiceShape>({}),
      deleteBrowserOwner: async () => undefined,
      acquireBrowserMutationFence: async () => () => undefined,
    })
    const bridge = await startGuiDesktopServiceBridge({
      client: { paths: fromPartial<LocalSessionHostPaths>({}), clientVersion: 'test' },
      executor,
      request: async (request) => {
        const response = await Effect.runPromise(instance.broker.handleGuiRequest(request))
        if (
          response.operation === 'poll' &&
          response.fences.some((fence) => fence.state === 'released')
        ) {
          snapshotReached.resolve()
          await allowReleaseSnapshot.promise
        }
        return response
      },
    })
    await open(workDirA)
    await settle()
    let completed = false
    const mutation = Effect.runPromise(
      instance.broker.runWithMutationFence(
        { kind: 'owner', ownerKey: OWNER },
        instance.broker.execute({
          service: 'terminal',
          operation: 'closeAllForOwner',
          input: { ownerKey: OWNER, deleteHistory: false },
        }),
      ),
    ).then(() => {
      completed = true
    })
    try {
      await snapshotReached.promise
      await settle()
      expect((await fs.stat(workDirA)).isDirectory()).toBe(true)
      expect(executor.hasActiveFences()).toBe(true)
      expect(completed).toBe(false)
      allowReleaseSnapshot.resolve()
      await mutation
      expect(executor.hasActiveFences()).toBe(false)
      expect(instance.records.size).toBe(0)
      expect((await fs.stat(workDirA)).isDirectory()).toBe(true)
      await expect(open(workDirA)).resolves.toMatchObject({ running: true })
      await settle()
      expect(spawn).toHaveBeenCalledTimes(2)
    } finally {
      allowReleaseSnapshot.resolve()
      await mutation
      const stopping = bridge.stop()
      await vi.advanceTimersByTimeAsync(1000)
      await stopping
      await Effect.runPromise(service.closeAll())
      await bridge.markClosed()
      instance.broker.close()
    }
  })
})
