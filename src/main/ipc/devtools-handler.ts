import * as Effect from 'effect/Effect'
import { getDevtoolsEventBusConfig } from '../devtools/event-bus'
import { typedHandle } from './typed-ipc'

export function registerDevtoolsHandlers(): void {
  typedHandle('devtools:get-event-bus-config', () => Effect.sync(() => getDevtoolsEventBusConfig()))
}
