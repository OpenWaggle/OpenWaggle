import type {
  DesktopMutationScope,
  DesktopServiceCommand,
  DesktopServiceRequest,
  DesktopServiceResponse,
  DesktopServiceResult,
} from '@shared/types/desktop-service'
import { Context } from 'effect'
import type { Effect } from 'effect/Effect'

export interface DesktopServiceBrokerShape {
  readonly execute: (command: DesktopServiceCommand) => Effect<DesktopServiceResult, Error>
  readonly handleGuiRequest: (
    request: DesktopServiceRequest,
  ) => Effect<DesktopServiceResponse, Error>
  readonly runWithMutationFence: <A, E, R>(
    scope: DesktopMutationScope,
    operation: Effect<A, E, R>,
  ) => Effect<A, E | Error, R>
  readonly close: () => void
}

export class DesktopServiceBroker extends Context.Tag('@openwaggle/DesktopServiceBroker')<
  DesktopServiceBroker,
  DesktopServiceBrokerShape
>() {}
