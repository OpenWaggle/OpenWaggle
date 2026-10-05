import { SessionHostEventHub } from '../application/session-host-event-hub'
import { SessionHostLiveness } from '../application/session-host-liveness'
import { createLogger } from '../logger'
import { LocalSessionInflightCommands } from './local-session-inflight-commands'
import {
  type LocalSessionServerDependencies,
  type LocalSessionServerHandle,
  listenLocalSessionServer,
} from './local-session-server'
import { monitorSessionHostEventLoop } from './session-host-event-loop-monitor'
import { installSessionHostEventRuntime } from './session-host-events'
import { acquireSessionHostOwnership, type SessionHostOwnership } from './session-host-ownership'

const SESSION_HOST_STARTUP_GRACE_PERIOD_MS = 30_000
const SESSION_HOST_CLIENT_HANDOFF_GRACE_PERIOD_MS = 1_000
const SESSION_HOST_SETTINGS_REFRESH_INTERVAL_MS = 1_000
const logger = createLogger('session-host/runtime')

async function collectStopError(errors: unknown[], cleanup: () => void | Promise<void>) {
  try {
    await cleanup()
  } catch (error) {
    errors.push(error)
  }
}

export interface StartLocalSessionHostInput {
  readonly endpoint: string
  readonly databasePath: string
  readonly authenticateServer?: LocalSessionServerDependencies['authenticateServer']
  readonly externalOwnership?: SessionHostOwnership
  readonly idleGracePeriodMs: number
  readonly readIdleGracePeriod?: () => Promise<number>
  readonly settingsRefreshIntervalMs?: number
  readonly startupGracePeriodMs?: number
  readonly eventReplayCapacity?: number
  readonly subscriberCapacity?: number
  readonly recover?: () => Promise<void>
  readonly startOwnedServices?: () => Promise<void>
  readonly stopOwnedServices?: () => Promise<void>
  readonly authenticate: LocalSessionServerDependencies['authenticate']
  readonly authorizeEvent?: LocalSessionServerDependencies['authorizeEvent']
  readonly refreshCaller?: LocalSessionServerDependencies['refreshCaller']
  readonly snapshotActiveRuns?: LocalSessionServerDependencies['snapshotActiveRuns']
  readonly authorizeActiveRun?: LocalSessionServerDependencies['authorizeActiveRun']
  readonly dispatch: LocalSessionServerDependencies['dispatch']
  readonly describeUpgradeBlockers?: LocalSessionServerDependencies['describeUpgradeBlockers']
}

const DRAIN_STOP_EVENT_GRACE_MS = 100
const DRAIN_STOP_FLUSH_POLL_MS = 20
const DRAIN_STOP_FLUSH_TIMEOUT_MS = 1_000

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
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
    private readonly releaseOwnershipOnStop: boolean,
    private readonly releaseEventPublisher: () => void,
    private readonly releaseBackgroundObservers: () => void = () => undefined,
    private readonly stopOwnedServices: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.stoppedPromise = new Promise((resolve) => {
      this.resolveStopped = resolve
    })
  }

  waitUntilStopped(): Promise<void> {
    return this.stoppedPromise
  }

  isStopping(): boolean {
    return this.stopPromise !== null
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.stopPromise = this.stopOnce()
    return this.stopPromise
  }

  /**
   * A drain ends when the last Run settles, which is also when its settlement event is
   * published. Give subscribers a bounded moment to receive it before sockets close, or a
   * client watching the Run sees the connection drop instead of the Run's result.
   */
  private async flushOutboundBeforeDrainStop() {
    if (!this.liveness.isDraining()) return
    const deadline = Date.now() + DRAIN_STOP_FLUSH_TIMEOUT_MS
    await delay(DRAIN_STOP_EVENT_GRACE_MS)
    while (this.server.outboundByteUsage().pendingBytes > 0 && Date.now() < deadline) {
      await delay(DRAIN_STOP_FLUSH_POLL_MS)
    }
  }

  private async stopOnce() {
    const errors: unknown[] = []
    try {
      await collectStopError(errors, () => this.flushOutboundBeforeDrainStop())
      await collectStopError(errors, () => this.server.close(false))
      await collectStopError(errors, this.stopOwnedServices)
      await collectStopError(errors, this.releaseBackgroundObservers)
      await collectStopError(errors, this.releaseEventPublisher)
      await collectStopError(errors, () => this.eventHub.close())
      await collectStopError(errors, () => this.liveness.close())
      await collectStopError(errors, () => this.server.removeEndpoint())
      if (this.releaseOwnershipOnStop) {
        await collectStopError(errors, () => this.ownership.release())
      }
    } finally {
      this.resolveStopped()
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Session Host shutdown failed in multiple cleanup stages.')
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

async function cleanupFailedStartup(input: {
  readonly runtime: LocalSessionHostRuntime | null
  readonly ownedServicesStartAttempted: boolean
  readonly stopOwnedServices: () => Promise<void>
  readonly releaseBackgroundObservers: () => void
  readonly releaseEventPublisher: () => void
  readonly eventHub: SessionHostEventHub
  readonly liveness: SessionHostLiveness
  readonly ownership: SessionHostOwnership
  readonly releaseOwnership: boolean
}) {
  if (input.runtime) {
    await input.runtime.stop()
    return
  }
  const errors: unknown[] = []
  if (input.ownedServicesStartAttempted) {
    await collectStopError(errors, input.stopOwnedServices)
  }
  await collectStopError(errors, input.releaseBackgroundObservers)
  await collectStopError(errors, input.releaseEventPublisher)
  await collectStopError(errors, () => input.eventHub.close())
  await collectStopError(errors, () => input.liveness.close())
  if (input.releaseOwnership) {
    await collectStopError(errors, () => input.ownership.release())
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Session Host startup cleanup failed in multiple stages.')
  }
}

function createServerDependencies(input: {
  readonly host: StartLocalSessionHostInput
  readonly eventHub: SessionHostEventHub
  readonly liveness: SessionHostLiveness
  readonly inflightCommands: LocalSessionInflightCommands
}): LocalSessionServerDependencies {
  const { host, eventHub, liveness, inflightCommands } = input
  return {
    hostInstanceId: eventHub.hostInstanceId,
    inflightCommands,
    ...(host.authenticateServer ? { authenticateServer: host.authenticateServer } : {}),
    eventHub,
    liveness,
    authenticate: host.authenticate,
    ...(host.authorizeEvent ? { authorizeEvent: host.authorizeEvent } : {}),
    ...(host.refreshCaller ? { refreshCaller: host.refreshCaller } : {}),
    ...(host.snapshotActiveRuns ? { snapshotActiveRuns: host.snapshotActiveRuns } : {}),
    ...(host.authorizeActiveRun ? { authorizeActiveRun: host.authorizeActiveRun } : {}),
    ...(host.describeUpgradeBlockers
      ? { describeUpgradeBlockers: host.describeUpgradeBlockers }
      : {}),
    requestUpgradeDrain: () => liveness.requestDrain('upgrade'),
    dispatch: host.dispatch,
  }
}

export async function startLocalSessionHost(
  input: StartLocalSessionHostInput,
): Promise<LocalSessionHostRuntime> {
  const ownership =
    input.externalOwnership ?? (await acquireSessionHostOwnership(input.databasePath))
  const releaseOwnershipOnStop = input.externalOwnership === undefined
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
  const inflightCommands = new LocalSessionInflightCommands()
  // Started before recovery and owned services, whose startup work can block the loop too.
  const releaseStallMonitor = monitorSessionHostEventLoop(liveness, inflightCommands)
  let releaseBackgroundObservers: () => void = releaseStallMonitor
  let ownedServicesStartAttempted = false

  try {
    releaseEventPublisher = installSessionHostEventRuntime({ eventHub, liveness })
    await input.recover?.()
    if (input.startOwnedServices) {
      ownedServicesStartAttempted = true
      await input.startOwnedServices()
    }
    if (input.readIdleGracePeriod) {
      const releaseIdleGraceObserver = observeIdleGracePeriod({
        liveness,
        read: input.readIdleGracePeriod,
        intervalMs: input.settingsRefreshIntervalMs ?? SESSION_HOST_SETTINGS_REFRESH_INTERVAL_MS,
      })
      releaseBackgroundObservers = () => {
        releaseStallMonitor()
        releaseIdleGraceObserver()
      }
    }
    const server = await listenLocalSessionServer(
      input.endpoint,
      createServerDependencies({ host: input, eventHub, liveness, inflightCommands }),
    )
    runtime = new LocalSessionHostRuntime(
      eventHub,
      liveness,
      server,
      ownership,
      releaseOwnershipOnStop,
      releaseEventPublisher,
      releaseBackgroundObservers,
      input.stopOwnedServices,
    )
    liveness.armIdleShutdown(
      input.startupGracePeriodMs ??
        Math.max(input.idleGracePeriodMs, SESSION_HOST_STARTUP_GRACE_PERIOD_MS),
    )
    return runtime
  } catch (error) {
    try {
      await cleanupFailedStartup({
        runtime,
        ownedServicesStartAttempted,
        stopOwnedServices: input.stopOwnedServices ?? (() => Promise.resolve()),
        releaseBackgroundObservers,
        releaseEventPublisher,
        eventHub,
        liveness,
        ownership,
        releaseOwnership: releaseOwnershipOnStop,
      })
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Session Host startup and cleanup both failed.',
        { cause: cleanupError },
      )
    }
    throw error
  }
}
