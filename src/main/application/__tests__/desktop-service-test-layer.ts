import type { DesktopServiceCommand } from '@shared/types/desktop-service'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { DesktopServiceBroker } from '../../ports/desktop-service-broker'
import { NoopTerminalServiceLayer } from './terminal-service-test-layer'

/** No native resources exist in these application tests; unexpected desktop commands fail. */
export const NoopSessionDesktopLayer = Layer.mergeAll(
  NoopTerminalServiceLayer,
  Layer.succeed(
    DesktopServiceBroker,
    fromPartial<DesktopServiceBroker['Type']>({
      execute: (command: DesktopServiceCommand) =>
        command.service === 'browser' && command.operation === 'deleteOwner'
          ? Effect.succeed({ service: 'browser', operation: 'deleteOwner', value: null })
          : Effect.dieMessage('Unexpected desktop command in Session lifecycle test'),
    }),
  ),
)
