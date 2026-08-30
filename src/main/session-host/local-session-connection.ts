import { randomUUID } from 'node:crypto'
import type { Socket } from 'node:net'
import { decodeLocalSessionClientFrame } from '@shared/schemas/local-session-protocol'
import type {
  LocalSessionClientFrame,
  LocalSessionServerFrame,
} from '@shared/types/local-session-protocol'
import type {
  SessionHostEventCursor,
  SessionHostEventEnvelope,
} from '@shared/types/session-host-event'
import { executeLocalSessionCommandFrame } from './local-session-command-frame'
import { establishLocalSessionHandshake } from './local-session-handshake'
import {
  LocalSessionInboundCapacityError,
  LocalSessionInboundRetention,
} from './local-session-inbound-retention'
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
import {
  describeLocalSessionServerError,
  writeLocalSessionSocketFrame,
} from './local-session-server-frame'
import {
  type ActiveLocalSessionSubscription,
  localSessionEventIsDenied,
  pumpLocalSessionSubscription,
} from './local-session-subscription-pump'

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000

function requiresAsynchronousAdmission(scope: {
  readonly all?: boolean
  readonly workspaceRoots?: readonly string[]
  readonly projectPaths?: readonly string[]
  readonly hiveRootSessionIds?: readonly string[]
}) {
  return (
    scope.all ||
    [scope.workspaceRoots, scope.projectPaths, scope.hiveRootSessionIds].some(
      (values) => (values?.length ?? 0) > 0,
    )
  )
}

function exactSessionAdmissionFilter(caller: AuthenticatedLocalSessionCaller) {
  const authority = caller.profileAuthority
  if (!authority) return () => true
  const scope = caller.baseProfileScope ?? authority.scope
  const requiresAsyncAdmission = requiresAsynchronousAdmission(scope)
  const allowedSessionIds = new Set(scope.sessionIds ?? [])
  for (const derived of caller.derivedSessionAuthorities ?? []) {
    allowedSessionIds.add(derived.sessionId)
  }
  return (event: SessionHostEventEnvelope) => {
    if (event.payload.kind === 'semantic-discovery-readiness-changed') return false
    return requiresAsyncAdmission || allowedSessionIds.has(event.payload.sessionId)
  }
}

export class LocalSessionConnection {
  private readonly inbound: LocalSessionInboundRetention
  private readonly subscriptions = new Map<string, ActiveLocalSessionSubscription>()
  private readonly commandControllers = new Map<string, AbortController>()
  private readTail = Promise.resolve()
  private writeTail = Promise.resolve()
  private caller: AuthenticatedLocalSessionCaller | null = null
  private negotiatedRevision: number | null = null
  private releaseClientLiveness: (() => void) | null = null
  private closed = false
  private readonly handshakeTimer: ReturnType<typeof setTimeout>
  private readonly authenticationController = new AbortController()

  constructor(
    private readonly socket: Socket,
    private readonly dependencies: LocalSessionServerDependencies,
    inboundBudget: LocalSessionInboundByteBudget,
    private readonly authenticationBudget: LocalSessionAuthenticationBudget,
  ) {
    this.inbound = new LocalSessionInboundRetention(inboundBudget)
    const timeout = dependencies.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS
    this.handshakeTimer = setTimeout(() => {
      void this.fail(undefined, 'handshake_timeout', 'Local Session handshake timed out.')
    }, timeout)
  }

  start(): void {
    this.socket.on('data', (chunk) => {
      this.socket.pause()
      try {
        const values = this.inbound.push(chunk, MAX_DECODED_FRAMES_PER_CHUNK)
        this.readTail = this.readTail
          .then(async () => {
            for (const value of values) await this.handleValue(value)
          })
          .catch((error) =>
            this.fail(undefined, 'protocol_error', describeLocalSessionServerError(error)),
          )
          .finally(() => {
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

  shutdown(): void {
    this.socket.destroy()
  }

  private send(frame: LocalSessionServerFrame | unknown): Promise<void> {
    this.writeTail = this.writeTail.then(() => {
      if (this.closed || this.socket.destroyed || !this.socket.writable) return
      return writeLocalSessionSocketFrame(this.socket, frame)
    })
    return this.writeTail
  }

  private async handleValue(value: unknown): Promise<void> {
    if (!this.caller || this.negotiatedRevision === null) {
      await this.handleHello(value)
      return
    }
    await this.handleClientFrame(decodeLocalSessionClientFrame(value))
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
      exactSessionAdmissionFilter(caller),
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
    this.inbound.release()
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
