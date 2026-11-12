import type { SessionHostEventEnvelope } from '@shared/types/session-host-event'
import * as Effect from 'effect/Effect'
import * as Runtime from 'effect/Runtime'
import { isDesktopAppConnected } from '../application/desktop-notifications/desktop-app-presence'
import { DesktopNotificationLedger } from '../application/desktop-notifications/desktop-notification-ledger'
import { DesktopNotificationObserver } from '../application/desktop-notifications/desktop-notification-observer'
import { installDesktopNotificationList } from '../application/desktop-notifications/desktop-notification-registry'
import { installScheduledTaskAttentionListener } from '../application/desktop-notifications/desktop-notification-signals'
import { HostStateDesktopNotifications } from '../application/desktop-notifications/host-state-desktop-notifications'
import { hivePendingRequestsBySession } from '../application/hive-pending-requests'
import { createLogger } from '../logger'
import { DesktopNotificationFacts } from '../ports/desktop-notification-facts'
import { DesktopNotificationHostPresenter } from '../ports/desktop-notification-host-presenter'
import { SettingsService } from '../services/settings-service'
import { publishSessionHostEvent, tryGetSessionHostEventRuntime } from './session-host-events'

const logger = createLogger('desktop-notifications')

/** Stuck Workers are derived; their check runs at most this often after a state change. */
const STUCK_SCAN_DEBOUNCE_MS = 1_000
/**
 * Runs lost with the previous Host are announced this long after start, so a desktop app that
 * started the Host has connected and shows them, instead of the Host.
 */
const HOST_LOSS_ANNOUNCE_DELAY_MS = 10_000

function changesStuckWorkers(envelope: SessionHostEventEnvelope) {
  const { payload } = envelope
  if (payload.kind === 'session-state-changed') return true
  return payload.kind === 'session-list-changed' && payload.catalogOnly !== true
}

/**
 * The Session Host's Desktop notifications (ADR 0062): observes the Host's own events, decides
 * when a notification is due, and serves the outstanding ones to the desktop app.
 */
export const runDesktopNotificationsBackground = Effect.gen(function* () {
  const eventRuntime = tryGetSessionHostEventRuntime()
  if (!eventRuntime) return
  const facts = yield* DesktopNotificationFacts
  const hostPresenter = yield* DesktopNotificationHostPresenter
  const settings = yield* SettingsService
  const runtime = yield* Effect.runtime()
  const runFork = Runtime.runFork(runtime)
  const ledger = new DesktopNotificationLedger({
    facts,
    readSettings: () => settings.get(),
    publish: publishSessionHostEvent,
    desktopAppConnected: isDesktopAppConnected,
    hostPresenter,
  })
  const observer = new DesktopNotificationObserver({
    ledger,
    facts,
    pendingRequest: (sessionId) => hivePendingRequestsBySession().get(sessionId) ?? null,
  })
  const hostState = new HostStateDesktopNotifications({
    ledger,
    observer,
    facts,
    now: () => Date.now(),
  })
  // Recovery has already run: it marks the Runs it found interrupted with its own time.
  const hostStartedAt = Math.floor(performance.timeOrigin)
  const releaseList = installDesktopNotificationList(ledger)
  const releaseAttention = installScheduledTaskAttentionListener((signal) => {
    runFork(hostState.notifyScheduledTaskAttention(signal))
  })
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      releaseAttention()
      releaseList()
    }),
  )

  let stuckScanDue = true
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        if (stuckScanDue) {
          stuckScanDue = false
          yield* hostState.scanStuckWorkers()
        }
        // A held Ready to read whose expected Hive wake never started (ADR 0065).
        yield* Effect.gen(function* () {
          if (!observer.holdingReadyToRead) return
          // Only Worker Runs use the limit; the person's own Runs never hold a wake back.
          const active = yield* facts.activeWorkerRunCount()
          const { sessionHostRunCeiling } = yield* settings.get()
          yield* observer.settleHeldReadyToRead(Date.now(), active >= sessionHostRunCeiling)
        }).pipe(
          Effect.catchAllCause((cause) =>
            Effect.logWarning('Held Ready to read could not be re-checked', cause),
          ),
        )
        yield* Effect.sleep(STUCK_SCAN_DEBOUNCE_MS)
      }
    }),
  )
  yield* Effect.forkScoped(
    Effect.sleep(HOST_LOSS_ANNOUNCE_DELAY_MS).pipe(
      Effect.zipRight(hostState.notifyRunsInterruptedByHostLoss(hostStartedAt)),
    ),
  )

  const subscribe = () => {
    const result = eventRuntime.eventHub.subscribeAfter()
    if (result.status !== 'ready') throw new Error('Desktop notifications could not subscribe.')
    return result.subscription
  }
  let subscription = subscribe()
  yield* Effect.addFinalizer(() => Effect.sync(() => subscription.close()))
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      while (true) {
        const delivery = yield* Effect.promise(() => subscription.next())
        if (delivery.status === 'closed') return
        if (delivery.status === 'resync-required') {
          logger.warn('Desktop notifications missed Host events', { reason: delivery.reason })
          subscription.close()
          subscription = subscribe()
          stuckScanDue = true
          continue
        }
        if (delivery.status !== 'event') continue
        if (changesStuckWorkers(delivery.event)) stuckScanDue = true
        yield* observer.handle(delivery.event)
      }
    }),
  )
})
