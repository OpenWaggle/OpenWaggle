import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { brokerHarness } from '../../application/__tests__/desktop-service-broker.test-harness'
import {
  DesktopNativeQuarantinedError,
  startGuiDesktopServiceBridge,
} from '../gui-desktop-service-bridge'
import type { GuiDesktopServiceExecutor } from '../gui-desktop-service-executor'
import type { LocalSessionHostPaths } from '../local-session-paths'

vi.mock('../local-session-client', () => ({ executeLocalSessionCommand: vi.fn() }))
vi.mock('../local-session-paths', () => ({ refreshLocalSessionHostEndpoint: vi.fn() }))
vi.mock('../../logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))

const GUI_ID = '00000000-0000-4000-8000-000000000002'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('real desktop broker and GUI bridge recovery after an unclean quit', () => {
  it('stays quarantined on launch, then attaches and quits cleanly after the user recovers', async () => {
    // The durable owner a GUI left behind when its quit could not reach the Host.
    const instance = brokerHarness([], {
      guiInstanceId: 'gui-that-quit-uncleanly',
      hostInstanceId: 'host-old',
      state: 'active',
    })
    const executor = fromPartial<GuiDesktopServiceExecutor>({
      guiInstanceId: GUI_ID,
      reconcile: async () => ({ released: [], activeTokens: [] }),
      isIdle: () => true,
      hasActiveFences: () => false,
      cancelCommands: vi.fn(),
    })
    const input = {
      client: { paths: fromPartial<LocalSessionHostPaths>({}), clientVersion: 'test' },
      executor,
      request: (request: Parameters<typeof instance.broker.handleGuiRequest>[0]) =>
        Effect.runPromise(instance.broker.handleGuiRequest(request)),
    }
    try {
      await expect(startGuiDesktopServiceBridge(input)).rejects.toBeInstanceOf(
        DesktopNativeQuarantinedError,
      )
      // Restarting alone never clears it.
      await expect(startGuiDesktopServiceBridge(input)).rejects.toBeInstanceOf(
        DesktopNativeQuarantinedError,
      )
      expect(instance.ownerRecord()?.guiInstanceId).toBe('gui-that-quit-uncleanly')

      const bridge = await startGuiDesktopServiceBridge({ ...input, recoverPreviousOwner: true })
      expect(instance.ownerRecord()).toEqual({
        guiInstanceId: GUI_ID,
        hostInstanceId: 'host-one',
        state: 'active',
      })
      const stopping = bridge.stop()
      await vi.advanceTimersByTimeAsync(1000)
      await stopping
      await bridge.markClosed()
      expect(instance.ownerRecord()).toMatchObject({ guiInstanceId: GUI_ID, state: 'closed' })
      // The next launch attaches normally.
      expect((await instance.register('next-launch')).operation).toBe('register')
    } finally {
      instance.broker.close()
    }
  })
})
