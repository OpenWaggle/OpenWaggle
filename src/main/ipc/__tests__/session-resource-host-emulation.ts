/*
 * The window reads Session resource bytes and thumbnails from the Session Host (A-F5). Here the
 * Host's own operations answer them, against a test's stores. The harness mocks the window's
 * router to call `relaySessionResourceHostRequest`: a `vi.mock` here would register after the
 * handlers under test had loaded the real router.
 */
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import type * as Layer from 'effect/Layer'
import type { SessionRepository } from '../../ports/session-repository'
import type { SessionResourceRepository } from '../../ports/session-resource-repository'
import type { SessionResourceStore } from '../../ports/session-resource-store'
import type { SessionResourceThumbnailer } from '../../ports/session-resource-thumbnailer'

/** The stores the two content operations read; the dispatcher's type spans every channel. */
type SessionResourceHostServices =
  | SessionRepository
  | SessionResourceRepository
  | SessionResourceStore
  | SessionResourceThumbnailer

let relay: (channel: string, args: readonly unknown[]) => Promise<unknown> = async () => ({
  handled: false,
})

/** What the window's Host client receives; the harness's mock of the router answers with it. */
export function relaySessionResourceHostRequest(channel: string, args: readonly unknown[]) {
  return relay(channel, args)
}

export function emulateSessionResourceHost(layer: Layer.Layer<SessionResourceHostServices>) {
  relay = async (channel, args) => {
    if (channel !== 'sessions:resources:host-content' && channel !== 'sessions:resources:thumbnail')
      return { handled: false }
    const { dispatchHostUiSessionResourceOperation: dispatch } = await import(
      '../../application/host-ui-session-resource-operation-dispatcher'
    )
    const operation = fromAny<
      Effect.Effect<unknown, unknown, SessionResourceHostServices>,
      unknown
    >(dispatch(channel, args))
    return { handled: true, result: await Effect.runPromise(Effect.provide(operation, layer)) }
  }
}
