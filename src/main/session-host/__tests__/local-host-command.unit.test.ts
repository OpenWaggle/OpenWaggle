import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS,
  dispatchLocalHostCommand,
} from '../local-host-command'

const payload = {
  contract: 'local-host-v1',
  request: { contractVersion: 1, operation: 'stop' },
} as const

function caller(identity: Partial<LocalSessionCallerIdentity>) {
  return fromPartial<LocalSessionCallerIdentity>(identity)
}

describe('Session Host stop command', () => {
  it('lets the local user stop the Host and reports what it waits for', async () => {
    const requestHostStop = vi.fn(() => ({ hostInstanceId: 'host-1', runningActions: 1 }))

    await expect(
      dispatchLocalHostCommand({
        caller: caller({ callerId: 'local-user:ada' }),
        payload,
        countBlockingRuns: async () => 2,
        requestHostStop,
        processId: 4242,
      }),
    ).resolves.toEqual({
      contract: 'local-host-v1',
      response: {
        contractVersion: 1,
        operation: 'stop',
        hostInstanceId: 'host-1',
        blockingRuns: 2,
        blockingActions: 1,
      },
    })
    expect(requestHostStop).toHaveBeenCalledTimes(1)
    expect(requestHostStop).toHaveBeenCalledWith({})
  })

  it('lets the desktop app stop the Host to install an update, within a deadline', async () => {
    const requestHostStop = vi.fn(() => ({ hostInstanceId: 'host-1', runningActions: 1 }))

    await expect(
      dispatchLocalHostCommand({
        caller: caller({ callerId: 'gui:local-user' }),
        payload,
        countBlockingRuns: async () => 0,
        requestHostStop,
        processId: 4242,
      }),
    ).resolves.toMatchObject({
      // The desktop app waits for this process, because macOS still counts it after its socket closes.
      response: { hostInstanceId: 'host-1', blockingActions: 1, processId: 4242 },
    })
    // A Restart to update already let Runs finish or stopped them; an Action such as a dev server
    // must not keep the old version's Host, and with it the update, waiting.
    expect(requestHostStop).toHaveBeenCalledWith({
      deadlineMs: DESKTOP_UPDATE_HOST_STOP_DEADLINE_MS,
    })
  })

  it('still stops when the Runs it waits for cannot be counted', async () => {
    const requestHostStop = vi.fn(() => ({ hostInstanceId: 'host-1', runningActions: 0 }))

    await expect(
      dispatchLocalHostCommand({
        caller: caller({ callerId: 'local-user:ada' }),
        payload,
        countBlockingRuns: async () => {
          throw new Error('database busy')
        },
        requestHostStop,
      }),
    ).resolves.toMatchObject({ response: { blockingRuns: null } })
    expect(requestHostStop).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'a named profile',
      {
        callerId: 'local-user:ada',
        profileAuthority: fromPartial<NonNullable<LocalSessionCallerIdentity['profileAuthority']>>(
          {},
        ),
      },
    ],
    [
      'the desktop app with a named profile',
      {
        callerId: 'gui:local-user',
        profileAuthority: fromPartial<NonNullable<LocalSessionCallerIdentity['profileAuthority']>>(
          {},
        ),
      },
    ],
    ['an agent', { callerId: 'session-agent:s-1:r-1' }],
  ] satisfies [string, Partial<LocalSessionCallerIdentity>][])(
    'refuses %s without stopping anything',
    async (_label, identity) => {
      const requestHostStop = vi.fn(() => ({ hostInstanceId: 'host-1', runningActions: 1 }))

      await expect(
        dispatchLocalHostCommand({
          caller: caller(identity),
          payload,
          countBlockingRuns: async () => 0,
          requestHostStop,
        }),
      ).rejects.toMatchObject({ code: 'capability_denied' })
      expect(requestHostStop).not.toHaveBeenCalled()
    },
  )
})
