import { SessionHostEventHub } from '../application/session-host-event-hub'
import { SessionHostLiveness } from '../application/session-host-liveness'
import { createLogger } from '../logger'
import {
  type LocalSessionServerDependencies,
  type LocalSessionServerHandle,
  listenLocalSessionServer,
} from './local-session-server'
import { installSessionHostEventRuntime } from './session-host-events'
import { acquireSessionHostOwnership, type SessionHostOwnership } from './session-host-ownership'

const SESSION_HOST_STARTUP_GRACE_PERIOD_MS = 30_000
const SESSION_HOST_CLIENT_HANDOFF_GRACE_PERIOD_MS = 1_000
const SESSION_HOST_SETTINGS_REFRESH_INTERVAL_MS = 1_000
const logger = createLogger('session-host/runtime')

export interface StartLocalSessionHostInput {
  readonly endpoint: string
  readonly databasePath: string
  readonly idleGracePeriodMs: number
  readonly readIdleGracePeriod?: () => Promise<number>
  readonly settingsRefreshIntervalMs?: number
  readonly startupGracePeriodMs?: number
  readonly eventReplayCapacity?: number
  readonly subscriberCapacity?: number
  readonly recover?: () => Promise<void>
  readonly authenticate: LocalSessionServerDependencies['authenticate']
  readonly authorizeEvent?: LocalSessionServerDependencies['authorizeEvent']
  readonly snapshotActiveRuns?: LocalSessionServerDependencies['snapshotActiveRuns']
  readonly authorizeActiveRun?: LocalSessionServerDependencies['authorizeActiveRun']
  readonly dispatch: LocalSessionServerDependencies['dispatch']
  readonly describeUpgradeBlockers?: LocalSessionServerDependencies['describeUpgradeBlockers']
}

export class LocalSessionHostRuntime {
  private stopPromise: Promise<void> | null = null
  private readonly stoppedPromise: Promise<void>
  private resolveStopped!: () => void

  constructor(
    readonly eventHub: SessionHostEventHub,
    readonly liveness: SessionHostLiveness,
    private readonly server: LocalSessionServerHandle,
    private readonly ownership: SessionHostOwnership,
    private readonly releaseEventPublisher: () => void,
    private readonly releaseSettingsObserver: () => void = () => undefined,
  ) {
    this.stoppedPromise = new Promise((resolve) => {
      this.resolveStopped = resolve
    })
  }

  waitUntilStopped(): Promise<void> {
    return this.stoppedPromise
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.stopOnce()
    return this.stopPromise
  }

  private async stopOnce() {
    try {
      await this.server.close(false)
    } finally {
      this.releaseSettingsObserver()
      this.releaseEventPublisher()
      this.eventHub.close()
      this.liveness.close()
      try {
        await this.server.removeEndpoint()
      } finally {
        try {
          await this.ownership.release()
        } finally {
          this.resolveStopped()
        }
      }
    }
  }
}

function observeIdleGracePeriod(input: {
  readonly liveness: SessionHostLiveness
  readonly read: () => Promise<number>
  readonly intervalMs: number
}) {
  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (closed) return
    timer = setTimeout(() => {
      void input
        .read()
        .then((idleGracePeriodMs) => {
          if (!closed) input.liveness.updateIdleGracePeriod(idleGracePeriodMs)
        })
        .catch((error) => {
          logger.warn('Failed to refresh the Session Host idle grace period.', {
            error: error instanceof Error ? error.message : String(error),
          })
        })
        .finally(schedule)
    }, input.intervalMs)
  }
  schedule()
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
  }
}

export async function startLocalSessionHost(
  input: StartLocalSessionHostInput,
): Promise<LocalSessionHostRuntime> {
  const ownership = await acquireSessionHostOwnership(input.databasePath)
  const eventHub = new SessionHostEventHub({
    ...(input.eventReplayCapacity !== undefined
      ? { replayCapacity: input.eventReplayCapacity }
      : {}),
    ...(input.subscriberCapacity !== undefined
      ? { subscriberCapacity: input.subscriberCapacity }
      : {}),
  })
  let runtime: LocalSessionHostRuntime | null = null
  const liveness = new SessionHostLiveness({
    idleGracePeriodMs: input.idleGracePeriodMs,
    clientHandoffGracePeriodMs: SESSION_HOST_CLIENT_HANDOFF_GRACE_PERIOD_MS,
    requestShutdown: () => runtime?.stop(),
  })
  let releaseEventPublisher: () => void = () => undefined
  let releaseSettingsObserver: () => void = () => undefined

  try {
    releaseEventPublisher = installSessionHostEventRuntime({ eventHub, liveness })
    await input.recover?.()
    const server = await listenLocalSessionServer(input.endpoint, {
      hostInstanceId: eventHub.hostInstanceId,
      eventHub,
      liveness,
      authenticate: input.authenticate,
      ...(input.authorizeEvent ? { authorizeEvent: input.authorizeEvent } : {}),
      ...(input.snapshotActiveRuns ? { snapshotActiveRuns: input.snapshotActiveRuns } : {}),
      ...(input.authorizeActiveRun ? { authorizeActiveRun: input.authorizeActiveRun } : {}),
      ...(input.describeUpgradeBlockers
        ? { describeUpgradeBlockers: input.describeUpgradeBlockers }
        : {}),
      requestUpgradeDrain: () => liveness.requestDrain('upgrade'),
      dispatch: input.dispatch,
    })
    if (input.readIdleGracePeriod) {
      releaseSettingsObserver = observeIdleGracePeriod({
        liveness,
        read: input.readIdleGracePeriod,
        intervalMs: input.settingsRefreshIntervalMs ?? SESSION_HOST_SETTINGS_REFRESH_INTERVAL_MS,
      })
    }
    runtime = new LocalSessionHostRuntime(
      eventHub,
      liveness,
      server,
      ownership,
      releaseEventPublisher,
      releaseSettingsObserver,
    )
    liveness.armIdleShutdown(
      input.startupGracePeriodMs ??
        Math.max(input.idleGracePeriodMs, SESSION_HOST_STARTUP_GRACE_PERIOD_MS),
    )
    return runtime
  } catch (error) {
    releaseSettingsObserver()
    releaseEventPublisher()
    eventHub.close()
    liveness.close()
    await ownership.release()
    throw error
  }
}
