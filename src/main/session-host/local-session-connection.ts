import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import { decodeLocalSessionClientFrame } from '@shared/schemas/local-session-protocol'
import type {
  LocalSessionClientFrame,
  LocalSessionServerFrame,
} from '@shared/types/local-session-protocol'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import { executeLocalSessionCommandFrame } from './local-session-command-frame'
import { createLocalSessionEventAdmissionFilter } from './local-session-event-admission'
import { establishLocalSessionHandshake } from './local-session-handshake'
import {
  LocalSessionInboundCapacityError,
  LocalSessionInboundRetention,
} from './local-session-inbound-retention'
import type { LocalSessionOutboundByteBudget } from './local-session-outbound-budget'
import { LocalSessionOutboundWriter } from './local-session-outbound-writer'
import {
  type LocalSessionAuthenticationBudget,
  type LocalSessionInboundByteBudget,
  MAX_DECODED_FRAMES_PER_CHUNK,
  subscriptionLimitReached,
} from './local-session-resource-policy'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'
import { describeLocalSessionServerError } from './local-session-server-frame'
import {
  type ActiveLocalSessionSubscription,
  localSessionEventIsDenied,
  pumpLocalSessionSubscription,
} from './local-session-subscription-pump'

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000

export class LocalSessionConnection {
  private readonly inbound: LocalSessionInboundRetention
  private readonly subscriptions = new Map<string, ActiveLocalSessionSubscription>()
  private readonly commandControllers = new Map<string, AbortController>()
  private readTail = Promise.resolve()
  private profileRefreshTail = Promise.resolve()
  private caller: AuthenticatedLocalSessionCaller | null = null
  private negotiatedRevision: number | null = null
  private serverAuthenticated: boolean
  private releaseClientLiveness: (() => void) | null = null
  private closed = false
  private readonly handshakeTimer: ReturnType<typeof setTimeout>
  private readonly authenticationController = new AbortController()
  private readonly outbound: LocalSessionOutboundWriter

  constructor(
    private readonly socket: Socket,
    private readonly dependencies: LocalSessionServerDependencies,
    inboundBudget: LocalSessionInboundByteBudget,
    private readonly authenticationBudget: LocalSessionAuthenticationBudget,
    outboundBudget: LocalSessionOutboundByteBudget,
  ) {
    this.inbound = new LocalSessionInboundRetention(inboundBudget)
    this.outbound = new LocalSessionOutboundWriter(
      socket,
      outboundBudget,
      this.authenticationController.signal,
      dependencies.maxPendingOutboundFramesPerConnection,
    )
    this.serverAuthenticated = dependencies.authenticateServer === undefined
    const timeout = dependencies.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
    this.handshakeTimer = setTimeout(() => {
      void this.fail(undefined, 'handshake_timeout', 'Local Session handshake timed out.')
    }, timeout)
  }

  start(): void {
    this.socket.on('data', (chunk) => {
      this.socket.pause()
      try {
        const batch = this.inbound.push(chunk, MAX_DECODED_FRAMES_PER_CHUNK)
        this.readTail = this.readTail
          .then(async () => {
            for (const value of batch.values) {
              if (this.closed) break
              await this.handleValue(value)
            }
          })
          .catch((error) =>
            this.fail(undefined, 'protocol_error', describeLocalSessionServerError(error)),
          )
          .finally(() => {
            batch.release()
            if (!this.closed) this.socket.resume()
          })
      } catch (error) {
        const code =
          error instanceof LocalSessionInboundCapacityError
            ? 'inbound_backpressure_exceeded'
            : 'invalid_frame'
        void this.fail(undefined, code, describeLocalSessionServerError(error))
      }
    })
    this.socket.once('close', () => this.close())
    this.socket.once('error', () => this.close())
  }

  disconnectRevokedProfile(profileId: string): void {
    if (this.caller?.profileAuthority?.profileId === profileId) this.socket.end()
  }

  refreshProfileAdmission(profileId?: string): Promise<void> {
    const refresh = async () => {
      const caller = this.caller
      const authority = caller?.profileAuthority
      if (!caller || !authority || !caller.callerId.startsWith('profile:')) return
      if (profileId && authority.profileId !== profileId) return
      if (!this.dependencies.refreshCaller) return
      try {
        this.caller = await this.dependencies.refreshCaller(caller)
      } catch {
        this.socket.end()
      }
    }
    this.profileRefreshTail = this.profileRefreshTail.then(refresh, refresh)
    return this.profileRefreshTail
  }

  shutdown(): void {
    this.socket.destroy()
  }

  private send(frame: LocalSessionServerFrame | unknown): Promise<void> {
    return this.outbound.send(frame)
  }

  private async handleValue(value: unknown): Promise<void> {
    if (!this.serverAuthenticated) {
      await this.handleServerAuthentication(value)
      return
    }
    if (!this.caller || this.negotiatedRevision === null) {
      await this.handleHello(value)
      return
    }
    await this.handleClientFrame(decodeLocalSessionClientFrame(value))
  }

  private async handleServerAuthentication(value: unknown): Promise<void> {
    const authenticateServer = this.dependencies.authenticateServer
    if (!authenticateServer)
      throw new Error('Local Session Host identity authority is unavailable.')
    await this.send(await authenticateServer(value))
    this.serverAuthenticated = true
  }

  private async handleHello(value: unknown): Promise<void> {
    const result = await establishLocalSessionHandshake({
      value,
      socket: this.socket,
      dependencies: this.dependencies,
      budget: this.authenticationBudget,
      signal: this.authenticationController.signal,
      send: (frame) => this.send(frame),
      authenticationFailed: (error) =>
        this.fail(undefined, 'authentication_failed', describeLocalSessionServerError(error)),
    })
    if (result.status === 'closed') return
    this.caller = result.caller
    this.negotiatedRevision = result.revision
    this.inbound.markAuthenticated()
    this.releaseClientLiveness = this.dependencies.liveness.acquire('client')
    clearTimeout(this.handshakeTimer)
    await this.send(result.negotiation)
  }

  private async handleClientFrame(frame: LocalSessionClientFrame): Promise<void> {
    if (frame.kind === 'command') return this.handleCommand(frame)
    if (frame.kind === 'subscribe') return this.handleSubscribe(frame.requestId, frame.after)
    return this.handleUnsubscribe(frame.requestId, frame.subscriptionId)
  }

  private async handleCommand(frame: Extract<LocalSessionClientFrame, { kind: 'command' }>) {
    if (!this.caller || this.negotiatedRevision === null) return
    const controller = new AbortController()
    this.commandControllers.set(frame.requestId, controller)
    try {
      await executeLocalSessionCommandFrame({
        frame,
        caller: this.caller,
        negotiatedRevision: this.negotiatedRevision,
        dependencies: this.dependencies,
        signal: controller.signal,
        send: (response) => this.send(response),
      })
    } finally {
      this.commandControllers.delete(frame.requestId)
    }
  }

  private async handleSubscribe(requestId: string, cursor?: SessionHostEventCursor) {
    const caller = this.caller
    if (!caller) return
    if (subscriptionLimitReached(this.dependencies, this.subscriptions.size)) {
      await this.send({
        kind: 'error',
        requestId,
        code: 'subscription_limit_exceeded',
        message: 'The Local Session subscription limit was reached.',
        retryable: true,
      })
      return
    }
    const activeRunSnapshot = cursor ? undefined : (this.dependencies.snapshotActiveRuns?.() ?? [])
    const snapshotCursor = cursor ?? this.dependencies.eventHub.cursor()
    const result = this.dependencies.eventHub.subscribeAfter(
      snapshotCursor,
      createLocalSessionEventAdmissionFilter(() => this.caller),
      { advanceFilteredCursor: true },
    )
    if (result.status === 'resync-required') {
      await this.send({
        kind: 'resync-required',
        requestId,
        reason: result.reason,
        cursor: result.cursor,
      })
      return
    }
    const subscriptionId = randomUUID()
    const active = {
      subscription: result.subscription,
      releaseLiveness: this.dependencies.liveness.acquire('subscription'),
    } satisfies ActiveLocalSessionSubscription
    this.subscriptions.set(subscriptionId, active)
    const activeRuns = activeRunSnapshot
      ? (
          await Promise.all(
            activeRunSnapshot.map(async (snapshot) => ({
              snapshot,
              authorized: (await this.dependencies.authorizeActiveRun?.(caller, snapshot)) ?? true,
            })),
          )
        )
          .filter((entry) => entry.authorized)
          .map((entry) => entry.snapshot)
      : undefined
    await this.send({
      kind: 'subscribed',
      requestId,
      subscriptionId,
      cursor: snapshotCursor,
      ...(activeRuns ? { activeRuns } : {}),
    })
    void this.pumpSubscription(subscriptionId, active)
  }

  private async pumpSubscription(subscriptionId: string, active: ActiveLocalSessionSubscription) {
    try {
      await pumpLocalSessionSubscription({
        subscription: active.subscription,
        active: () => this.subscriptions.get(subscriptionId) === active,
        closed: () => this.closed,
        eventIsDenied: (event) =>
          localSessionEventIsDenied(this.caller, this.dependencies.authorizeEvent, event),
        send: (frame) => this.send({ ...frame, subscriptionId }),
      })
    } catch {
      this.socket.destroy()
    } finally {
      if (this.subscriptions.get(subscriptionId) === active) {
        this.subscriptions.delete(subscriptionId)
      }
      active.subscription.close()
      active.releaseLiveness()
    }
  }

  private async handleUnsubscribe(requestId: string, subscriptionId: string) {
    const active = this.subscriptions.get(subscriptionId)
    if (active) {
      this.subscriptions.delete(subscriptionId)
      active.subscription.close()
      active.releaseLiveness()
    }
    await this.send({ kind: 'unsubscribed', requestId, subscriptionId })
  }

  private async fail(requestId: string | undefined, code: string, message: string) {
    if (this.closed) return
    try {
      await this.send({
        kind: 'error',
        ...(requestId ? { requestId } : {}),
        code,
        message,
        retryable: false,
      })
    } finally {
      this.socket.end()
    }
  }

  private close(): void {
    if (this.closed) return
    this.closed = true
    this.authenticationController.abort()
    this.inbound.releasePendingFrame()
    clearTimeout(this.handshakeTimer)
    for (const controller of this.commandControllers.values()) {
      controller.abort(new Error('Local Session client disconnected.'))
    }
    this.commandControllers.clear()
    for (const active of this.subscriptions.values()) {
      active.subscription.close()
      active.releaseLiveness()
    }
    this.subscriptions.clear()
    this.releaseClientLiveness?.()
    this.releaseClientLiveness = null
  }
}
