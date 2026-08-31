import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import type { SessionHostEventSubscription } from '../application/session-host-event-hub'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'

export interface ActiveLocalSessionSubscription {
  readonly subscription: SessionHostEventSubscription
  readonly releaseLiveness: () => void
}

export async function localSessionEventIsDenied(
  caller: AuthenticatedLocalSessionCaller | null,
  authorizeEvent: LocalSessionServerDependencies['authorizeEvent'],
  event: SessionHostEventEnvelope,
) {
  return Boolean(caller && authorizeEvent && !(await authorizeEvent(caller, event)))
}

export async function pumpLocalSessionSubscription(input: {
  readonly subscription: SessionHostEventSubscription
  readonly active: () => boolean
  readonly closed: () => boolean
  readonly eventIsDenied: (event: SessionHostEventEnvelope) => Promise<boolean>
  readonly send: (frame: Readonly<Record<string, unknown>>) => Promise<void>
}) {
  while (!input.closed() && input.active()) {
    const delivery = await input.subscription.next()
    if (delivery.status === 'cursor-advanced') {
      await input.send({ kind: 'cursor-advanced', cursor: delivery.cursor })
      continue
    }
    if (delivery.status === 'event') {
      if (await input.eventIsDenied(delivery.event)) {
        await input.send({ kind: 'cursor-advanced', cursor: delivery.event.cursor })
        continue
      }
      await input.send({ kind: 'event', event: delivery.event })
      continue
    }
    if (delivery.status === 'resync-required') {
      await input.send({
        kind: 'resync-required',
        reason: delivery.reason,
        cursor: delivery.cursor,
      })
      return
    }
    if (!input.closed()) await input.send({ kind: 'subscription-closed' })
    return
  }
}
