import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { PiSessionDiscoveryRepository, PiSessionFiles } from '../ports/pi-session-discovery'
import { SessionSettingsRepository } from '../ports/session-settings-repository'
import { SessionTitleRepository } from '../ports/session-title-repository'
import { ThinkingLevelDefaultService } from '../ports/thinking-level-default-service'

/**
 * The services a Run's Pi session refresh reads when the runtime has them (ADR 0051): a discovered
 * Session's first Run takes in its Pi file and continues with its model, thinking level, and name.
 * A runtime without discovery runs without them, as the refresh skips itself.
 */
export function captureRunContinuationServices() {
  return Effect.gen(function* () {
    let context = Context.empty()
    const add = <I, S>(tag: Context.Tag<I, S>, service: Option.Option<S>) => {
      if (Option.isSome(service)) context = Context.add(context, tag, service.value)
    }
    add(PiSessionDiscoveryRepository, yield* Effect.serviceOption(PiSessionDiscoveryRepository))
    add(PiSessionFiles, yield* Effect.serviceOption(PiSessionFiles))
    add(SessionSettingsRepository, yield* Effect.serviceOption(SessionSettingsRepository))
    add(ThinkingLevelDefaultService, yield* Effect.serviceOption(ThinkingLevelDefaultService))
    add(SessionTitleRepository, yield* Effect.serviceOption(SessionTitleRepository))
    return context
  })
}
