import type { DesktopServiceRequest, DesktopServiceResponse } from '@shared/types/desktop-service'
import { fromPartial } from '@total-typescript/shoehorn'
import { vi } from 'vitest'
import type { GuiDesktopServiceExecutor } from '../gui-desktop-service-executor'
import type { GuiDesktopServiceLifecycle } from '../gui-desktop-service-lifecycle'
import type { LocalSessionHostPaths } from '../local-session-paths'

export const DESKTOP_TEST_GUI_ID = '00000000-0000-4000-8000-000000000001'

export function bridgeHarness() {
  const calls: DesktopServiceRequest[] = []
  const state = {
    readyFailures: 0,
    activeFence: false,
    quarantined: false,
    hostInstanceId: 'host-one',
    pollFailures: 0,
    rejectReceipt: false,
    rejectPreparation: false,
    rejectResume: false,
  }
  const reconcile = vi.fn(async () => ({ released: [], activeTokens: [] }))
  const executor: GuiDesktopServiceExecutor = fromPartial({
    guiInstanceId: DESKTOP_TEST_GUI_ID,
    reconcile,
    isIdle: () => true,
    hasActiveFences: () => state.activeFence,
    cancel: vi.fn(),
    cancelCommands: vi.fn(),
    execute: vi.fn(),
  })
  const request = async (request: DesktopServiceRequest): Promise<DesktopServiceResponse> => {
    calls.push(request)
    if (request.operation === 'register') {
      if (state.quarantined) return { operation: 'quarantined', reason: 'previous-owner-unclean' }
      return {
        operation: 'register',
        leaseId: 'lease-one',
        hostInstanceId: state.hostInstanceId,
        fences: [],
      }
    }
    if (request.operation === 'ready' && state.readyFailures > 0) {
      state.readyFailures -= 1
      throw new Error('Injected readiness rejection')
    }
    if (request.operation === 'poll') {
      await new Promise<void>((resolve) => setTimeout(resolve, 1000))
      if (state.pollFailures > 0) {
        state.pollFailures -= 1
        throw new Error('Injected transport failure')
      }
      return { operation: 'poll', commands: [], cancelledCommandIds: [], fences: [] }
    }
    if (request.operation === 'prepareDisconnect') {
      if (state.rejectPreparation) return { operation: 'ready', accepted: false }
      return { operation: 'prepareDisconnect', accepted: true, fences: [] }
    }
    const rejected =
      (request.operation === 'markClosed' && state.rejectReceipt) ||
      (request.operation === 'resumeDesktop' && state.rejectResume)
    return { operation: request.operation, accepted: !rejected }
  }
  return {
    calls,
    state,
    reconcile,
    input: {
      client: { paths: fromPartial<LocalSessionHostPaths>({}), clientVersion: 'test' },
      executor,
      request,
    },
  }
}

export async function stopBridge(lifecycle: GuiDesktopServiceLifecycle) {
  const stopping = lifecycle.stop()
  await vi.advanceTimersByTimeAsync(4000)
  await stopping
}
