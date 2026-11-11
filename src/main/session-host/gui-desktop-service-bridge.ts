import {
  DESKTOP_SERVICE_LIMITS,
  type DesktopCompletion,
  type DesktopServiceRequest,
  type DesktopServiceResponse,
} from '@shared/types/desktop-service'
import { createLogger } from '../logger'
import {
  DESKTOP_BRIDGE_TICK_MS,
  DESKTOP_SHUTDOWN_DRAIN_MS,
  DesktopNativeQuarantinedError,
  DesktopNativeRecoveryError,
  DesktopServiceAttachmentError,
  desktopBridgeDelay,
  type GuiDesktopBridgeInput,
  type GuiDesktopServiceLifecycle,
  registerGuiDesktop,
  runDesktopHeartbeat,
  withDesktopShutdownDeadline,
} from './gui-desktop-service-lifecycle'
import {
  type AcknowledgedDesktopRequest,
  makeGuiDesktopServiceRequest,
  requireAcknowledged,
} from './gui-desktop-service-request'
import type { LocalSessionHostPaths } from './local-session-paths'
import { refreshLocalSessionHostEndpoint } from './local-session-paths'

export {
  DesktopNativeQuarantinedError,
  DesktopNativeRecoveryError,
  DesktopServiceAttachmentError,
} from './gui-desktop-service-lifecycle'

const logger = createLogger('session-host/desktop-bridge')
const RETRY_DELAY_MS = 1_000
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
  private recoveryPending: boolean
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
    this.recoveryPending = input.recoverPreviousOwner === true
    this.paths = input.client.paths
    this.request =
      input.request ?? makeGuiDesktopServiceRequest(() => this.paths, input.client.clientVersion)
  }

  /** Sends `request` and throws `message` unless the Host accepted it. */
  private async acknowledge(
    request: AcknowledgedDesktopRequest,
    message: string,
    options?: ErrorOptions,
  ) {
    requireAcknowledged(await this.request(request), request.operation, message, options)
  }

  private async reconcile(
    ownerLeaseId: string,
    fences: Extract<DesktopServiceResponse, { operation: 'register' }>['fences'],
  ) {
    const state = await this.input.executor.reconcile(fences)
    for (const record of state.released) {
      await this.acknowledge(
        {
          operation: 'acknowledgeReleased',
          leaseId: ownerLeaseId,
          token: record.token,
          hostInstanceId: record.hostInstanceId,
        },
        'Desktop fence release was not acknowledged.',
      )
    }
    return state.activeTokens
  }

  private async attach() {
    const registered = await registerGuiDesktop({
      request: this.request,
      refresh: async () => {
        if (!this.input.request) this.paths = await refreshLocalSessionHostEndpoint(this.paths)
      },
      guiInstanceId: this.guiInstanceId,
      recovering: this.recoveryPending,
    })
    this.recoveryPending = false
    this.leaseId = registered.leaseId
    this.hostInstanceId = registered.hostInstanceId
    const activeTokens = await this.reconcile(registered.leaseId, registered.fences)
    await this.acknowledge(
      { operation: 'ready', leaseId: registered.leaseId, fenceTokens: activeTokens },
      'Desktop admission was not acknowledged.',
    )
    this.attached = true
    this.failureReported = false
  }

  private async complete(ownerLeaseId: string, completion: DesktopCompletion) {
    const response = await this.request({
      operation: 'complete',
      leaseId: ownerLeaseId,
      completion,
    })
    if (response.operation !== 'complete') {
      throw new Error('Invalid desktop completion acknowledgement.')
    }
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
      if (this.pending.size >= DESKTOP_SERVICE_LIMITS.pendingCommands) {
        throw new Error('Desktop command admission exceeded its bound.')
      }
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
    this.heartbeat = runDesktopHeartbeat(this.stopped.signal, HEARTBEAT_MS, async () => {
      if (this.leaseId === undefined) return
      await this.acknowledge(
        { operation: 'heartbeat', leaseId: this.leaseId },
        'Desktop heartbeat was not acknowledged.',
      )
    })
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
      await this.acknowledge(
        { operation: 'disconnect', leaseId: this.leaseId },
        'Desktop disconnect was not acknowledged.',
      )
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
          await this.acknowledge(
            { operation: 'prepareDisconnect', leaseId: drainingLease },
            'Desktop shutdown admission was not acknowledged.',
          )
          const pollBarrier = this.startedPoll
          // Only the pump reconciles snapshots. A fresh post-drain poll prevents an older
          // active snapshot racing a newer release and recreating an already-released hold.
          while (this.completedPoll <= pollBarrier || this.hasPendingWork()) {
            draining.signal.throwIfAborted()
            if (this.leaseId !== drainingLease) {
              throw new Error('Desktop ownership changed while shutdown was draining.')
            }
            await desktopBridgeDelay(DESKTOP_BRIDGE_TICK_MS, draining.signal)
          }
          if (this.leaseId !== drainingLease || !this.attached) {
            throw new Error('Desktop ownership changed before shutdown settled.')
          }
        })(),
        deadline,
      )
    } catch (error) {
      draining.abort()
      // Keep the pump available for release reconciliation and make the failed quit retryable.
      if (drainingLease !== undefined) {
        try {
          await this.acknowledge(
            { operation: 'resumeDesktop', leaseId: drainingLease },
            'Desktop admission recovery was not acknowledged.',
            { cause: error },
          )
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

  /** Commands, completions or native fences that a clean shutdown must wait for. */
  private hasPendingWork() {
    const executor = this.input.executor
    return !executor.isIdle() || executor.hasActiveFences() || this.pending.size !== 0
  }

  stop() {
    this.stopping ??= this.drainAndStop().finally(() => {
      this.stopping = undefined
    })
    return this.stopping
  }
  async markClosed() {
    if (!this.transportClosed || this.hasPendingWork() || this.hostInstanceId === undefined) {
      throw new Error('Desktop commands must drain before clean native shutdown can be recorded.')
    }
    if (!this.input.request) this.paths = await refreshLocalSessionHostEndpoint(this.paths)
    await this.acknowledge(
      {
        operation: 'markClosed',
        guiInstanceId: this.guiInstanceId,
        hostInstanceId: this.hostInstanceId,
      },
      'Desktop clean shutdown was not acknowledged.',
    )
  }
  attachment() {
    if (this.stopped.signal.aborted) return 'stopped'
    return this.attached ? 'attached' : 'reconnecting'
  }
  async start(): Promise<GuiDesktopServiceLifecycle> {
    this.startHeartbeat()
    try {
      await this.attach()
    } catch (error) {
      if (
        error instanceof DesktopNativeQuarantinedError ||
        error instanceof DesktopNativeRecoveryError
      ) {
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
