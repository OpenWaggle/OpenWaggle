import {
  DESKTOP_SERVICE_LIMITS,
  type DesktopCompletion,
  type DesktopServiceRequest,
  type DesktopServiceResponse,
} from '@shared/types/desktop-service'
import { LOCAL_SESSION_DESKTOP_SERVICE_REVISION } from '@shared/types/local-session-protocol'
import { createLogger } from '../logger'
import {
  DESKTOP_BRIDGE_TICK_MS,
  DESKTOP_SHUTDOWN_DRAIN_MS,
  DesktopNativeQuarantinedError,
  DesktopServiceAttachmentError,
  desktopBridgeDelay,
  type GuiDesktopBridgeInput,
  type GuiDesktopServiceLifecycle,
  withDesktopShutdownDeadline,
} from './gui-desktop-service-lifecycle'
import { executeLocalSessionCommand } from './local-session-client'
import type { LocalSessionHostPaths } from './local-session-paths'
import { refreshLocalSessionHostEndpoint } from './local-session-paths'

export {
  DesktopNativeQuarantinedError,
  DesktopServiceAttachmentError,
} from './gui-desktop-service-lifecycle'

const logger = createLogger('session-host/desktop-bridge')
const RETRY_DELAY_MS = 1_000
const REQUEST_TIMEOUT_MS = 10_000
const HEARTBEAT_MS = 5_000

/** Resolve only after native admission fences have been restored; retain the executor on reconnect. */
export function startGuiDesktopServiceBridge(input: GuiDesktopBridgeInput) {
  return new GuiDesktopServiceBridge(input).start()
}

class GuiDesktopServiceBridge implements GuiDesktopServiceLifecycle {
  private readonly guiInstanceId: string
  private readonly stopped = new AbortController()
  private readonly pending = new Set<Promise<void>>()
  private paths: LocalSessionHostPaths
  private leaseId: string | undefined
  private hostInstanceId: string | undefined
  private attached = false
  private failureReported = false
  private transportClosed = false
  private stopping: Promise<void> | undefined
  private pump: Promise<void> = Promise.resolve()
  private heartbeat: Promise<void> = Promise.resolve()
  private startedPoll = 0
  private completedPoll = 0
  private readonly request: (request: DesktopServiceRequest) => Promise<DesktopServiceResponse>

  constructor(private readonly input: GuiDesktopBridgeInput) {
    this.guiInstanceId = input.executor.guiInstanceId
    this.paths = input.client.paths
    this.request =
      input.request ??
      (async (message: DesktopServiceRequest) => {
        const result = await executeLocalSessionCommand({
          paths: this.paths,
          clientVersion: input.client.clientVersion,
          clientKind: 'gui',
          supportedRevisions: [LOCAL_SESSION_DESKTOP_SERVICE_REVISION],
          timeoutMs: REQUEST_TIMEOUT_MS,
          payload: { contract: 'desktop-service-v1', request: message },
        })
        if (result.contract !== 'desktop-service-v1')
          throw new Error('Invalid desktop-service response contract.')
        return result.response
      })
  }

  private async reconcile(
    ownerLeaseId: string,
    fences: Extract<DesktopServiceResponse, { operation: 'register' }>['fences'],
  ) {
    const state = await this.input.executor.reconcile(fences)
    for (const record of state.released) {
      const response = await this.request({
        operation: 'acknowledgeReleased',
        leaseId: ownerLeaseId,
        token: record.token,
        hostInstanceId: record.hostInstanceId,
      })
      if (response.operation !== 'acknowledgeReleased' || !response.accepted)
        throw new Error('Desktop fence release was not acknowledged.')
    }
    return state.activeTokens
  }

  private async attach() {
    if (!this.input.request) this.paths = await refreshLocalSessionHostEndpoint(this.paths)
    const registered = await this.request({
      operation: 'register',
      guiInstanceId: this.guiInstanceId,
    })
    if (registered.operation === 'quarantined') throw new DesktopNativeQuarantinedError()
    if (registered.operation !== 'register')
      throw new Error('Desktop registration was not acknowledged.')
    this.leaseId = registered.leaseId
    this.hostInstanceId = registered.hostInstanceId
    const activeTokens = await this.reconcile(registered.leaseId, registered.fences)
    const ready = await this.request({
      operation: 'ready',
      leaseId: registered.leaseId,
      fenceTokens: activeTokens,
    })
    if (ready.operation !== 'ready' || !ready.accepted)
      throw new Error('Desktop admission was not acknowledged.')
    this.attached = true
    this.failureReported = false
  }

  private async complete(ownerLeaseId: string, completion: DesktopCompletion) {
    const response = await this.request({
      operation: 'complete',
      leaseId: ownerLeaseId,
      completion,
    })
    if (response.operation !== 'complete')
      throw new Error('Invalid desktop completion acknowledgement.')
  }

  private async poll(ownerLeaseId: string) {
    const pollSequence = ++this.startedPoll
    const response = await this.request({ operation: 'poll', leaseId: ownerLeaseId })
    if (response.operation !== 'poll') throw new Error('Invalid desktop poll response.')
    if (this.stopped.signal.aborted || this.leaseId !== ownerLeaseId) return
    const cancelled = new Set(response.cancelledCommandIds)
    for (const commandId of cancelled) this.input.executor.cancel(commandId)
    await this.reconcile(ownerLeaseId, response.fences)
    for (const envelope of response.commands) {
      if (this.pending.size >= DESKTOP_SERVICE_LIMITS.pendingCommands)
        throw new Error('Desktop command admission exceeded its bound.')
      const job = (
        cancelled.has(envelope.commandId)
          ? Promise.resolve<DesktopCompletion>({
              commandId: envelope.commandId,
              outcome: 'failure',
              message: 'Desktop command was cancelled before execution.',
            })
          : this.input.executor.execute(envelope, ownerLeaseId)
      )
        .then((completion) => this.complete(ownerLeaseId, completion))
        .catch(() => {
          // Never replay an action whose result failed to reach the Host.
          logger.warn(
            'A desktop operation completion could not be delivered; the Host will retain uncertainty.',
          )
        })
        .finally(() => this.pending.delete(job))
      this.pending.add(job)
    }
    this.completedPoll = pollSequence
  }

  private startHeartbeat() {
    this.heartbeat = (async () => {
      while (!this.stopped.signal.aborted) {
        await desktopBridgeDelay(HEARTBEAT_MS, this.stopped.signal)
        if (this.stopped.signal.aborted || this.leaseId === undefined) continue
        try {
          const response = await this.request({ operation: 'heartbeat', leaseId: this.leaseId })
          if (response.operation !== 'heartbeat' || !response.accepted)
            throw new Error('Desktop heartbeat was not acknowledged.')
        } catch {
          // Poll/attach owns reconnect. A heartbeat failure never releases local native fences.
          if (!this.stopped.signal.aborted)
            logger.warn('Desktop lease heartbeat failed; native fences remain held.')
        }
      }
    })()
  }

  private startPump() {
    this.pump = (async () => {
      while (!this.stopped.signal.aborted) {
        try {
          if (!this.attached) await this.attach()
          if (this.leaseId !== undefined) await this.poll(this.leaseId)
        } catch {
          this.input.executor.cancelCommands()
          this.attached = false
          if (!this.failureReported && !this.stopped.signal.aborted) {
            logger.warn(
              'Desktop services disconnected; native mutation fences remain held until reconciliation.',
            )
            this.failureReported = true
          }
          await desktopBridgeDelay(RETRY_DELAY_MS, this.stopped.signal)
        }
      }
    })()
  }

  private async finishStop() {
    this.stopped.abort()
    await Promise.all([this.pump, this.heartbeat])
    if (this.leaseId !== undefined) {
      if (!this.input.request) this.paths = await refreshLocalSessionHostEndpoint(this.paths)
      const response = await this.request({ operation: 'disconnect', leaseId: this.leaseId })
      if (response.operation !== 'disconnect' || !response.accepted)
        throw new Error('Desktop disconnect was not acknowledged.')
    }
    this.transportClosed = true
  }

  private async drainAndStop() {
    if (this.transportClosed) return
    if (this.stopped.signal.aborted) return this.finishStop()
    const deadline = Date.now() + DESKTOP_SHUTDOWN_DRAIN_MS
    const draining = new AbortController()
    let drainingLease: string | undefined
    try {
      await withDesktopShutdownDeadline(
        (async () => {
          while (this.leaseId === undefined) {
            draining.signal.throwIfAborted()
            await desktopBridgeDelay(DESKTOP_BRIDGE_TICK_MS, draining.signal)
          }
          drainingLease = this.leaseId
          const response = await this.request({
            operation: 'prepareDisconnect',
            leaseId: drainingLease,
          })
          if (response.operation !== 'prepareDisconnect' || !response.accepted)
            throw new Error('Desktop shutdown admission was not acknowledged.')
          const pollBarrier = this.startedPoll
          // Only the pump reconciles snapshots. A fresh post-drain poll prevents an older
          // active snapshot racing a newer release and recreating an already-released hold.
          while (
            this.completedPoll <= pollBarrier ||
            !this.input.executor.isIdle() ||
            this.input.executor.hasActiveFences() ||
            this.pending.size !== 0
          ) {
            draining.signal.throwIfAborted()
            if (this.leaseId !== drainingLease)
              throw new Error('Desktop ownership changed while shutdown was draining.')
            await desktopBridgeDelay(DESKTOP_BRIDGE_TICK_MS, draining.signal)
          }
          if (this.leaseId !== drainingLease || !this.attached)
            throw new Error('Desktop ownership changed before shutdown settled.')
        })(),
        deadline,
      )
    } catch (error) {
      draining.abort()
      // Keep the pump available for release reconciliation and make the failed quit retryable.
      if (drainingLease !== undefined) {
        try {
          const response = await this.request({
            operation: 'resumeDesktop',
            leaseId: drainingLease,
          })
          if (response.operation !== 'resumeDesktop' || !response.accepted)
            throw new Error('Desktop admission recovery was not acknowledged.', { cause: error })
        } catch (resumeError) {
          throw new AggregateError(
            [error, resumeError],
            'Desktop shutdown and admission recovery failed.',
            { cause: resumeError },
          )
        }
      }
      throw error
    }
    await this.finishStop()
  }

  stop() {
    this.stopping ??= this.drainAndStop().finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }
  async markClosed() {
    if (
      !this.transportClosed ||
      !this.input.executor.isIdle() ||
      this.input.executor.hasActiveFences() ||
      this.pending.size !== 0 ||
      this.hostInstanceId === undefined
    ) {
      throw new Error('Desktop commands must drain before clean native shutdown can be recorded.')
    }
    if (!this.input.request) this.paths = await refreshLocalSessionHostEndpoint(this.paths)
    const response = await this.request({
      operation: 'markClosed',
      guiInstanceId: this.guiInstanceId,
      hostInstanceId: this.hostInstanceId,
    })
    if (response.operation !== 'markClosed' || !response.accepted)
      throw new Error('Desktop clean shutdown was not acknowledged.')
  }
  async start(): Promise<GuiDesktopServiceLifecycle> {
    this.startHeartbeat()
    try {
      await this.attach()
    } catch (error) {
      if (error instanceof DesktopNativeQuarantinedError) {
        this.stopped.abort()
        await this.heartbeat
        throw error
      }
      this.startPump()
      throw new DesktopServiceAttachmentError(this, error)
    }
    this.startPump()
    return this
  }
}
