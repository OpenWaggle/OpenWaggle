import type { DesktopServiceResponse } from '@shared/types/desktop-service'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { DesktopServiceBroker } from '../../ports/desktop-service-broker'
import { dispatchDesktopServiceRequest } from '../desktop-service-request-dispatcher'

describe('GUI-only desktop reverse service boundary', () => {
  const request = { operation: 'register', guiInstanceId: 'gui-instance' } as const

  it.each([
    fromPartial<LocalSessionCallerIdentity>({ callerId: 'cli:local-user' }),
    fromPartial<LocalSessionCallerIdentity>({ callerId: 'agent:session-one' }),
    fromPartial<LocalSessionCallerIdentity>({ callerId: 'gui:local-user', profileAuthority: {} }),
  ])('rejects a non-GUI or profile-scoped identity before resolving the broker', async (caller) => {
    await expect(
      Effect.runPromise(
        dispatchDesktopServiceRequest({ caller, request }).pipe(
          Effect.provideService(DesktopServiceBroker, fromPartial({})),
        ),
      ),
    ).rejects.toThrow('authenticated GUI Local-user')
  })

  it('rejects the previous negotiated revision before resolving the broker', async () => {
    await expect(
      Effect.runPromise(
        dispatchDesktopServiceRequest({
          caller: fromPartial({ callerId: 'gui:local-user' }),
          request,
          negotiatedRevision: 10,
        }).pipe(Effect.provideService(DesktopServiceBroker, fromPartial({}))),
      ),
    ).rejects.toThrow('revision 11')
  })

  it('forwards an authorized current GUI request exactly once', async () => {
    const response: DesktopServiceResponse = {
      operation: 'quarantined',
      reason: 'previous-owner-unclean',
    }
    const handleGuiRequest = vi.fn(() => Effect.succeed(response))
    const result = await Effect.runPromise(
      dispatchDesktopServiceRequest({
        caller: fromPartial({ callerId: 'gui:local-user' }),
        request,
        negotiatedRevision: 11,
      }).pipe(Effect.provideService(DesktopServiceBroker, fromPartial({ handleGuiRequest }))),
    )
    expect(result).toEqual({ contract: 'desktop-service-v1', response })
    expect(handleGuiRequest).toHaveBeenCalledExactlyOnceWith(request)
  })
})
