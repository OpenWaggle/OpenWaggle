import type { Socket } from 'node:net'
import { decodeLocalSessionClientFrame } from '@shared/schemas/local-session-protocol'
import type {
  LocalSessionClientFrame,
  LocalSessionServerFrame,
} from '@shared/types/local-session-protocol'
import { LocalSessionAdmissionGate } from './local-session-admission-gate'
import {
  type ActiveLocalSessionCommand,
  isSelfProfileCredentialMutation,
  LocalSessionProfileAdmissionChangedError,
} from './local-session-command-admission'
import { executeLocalSessionCommandFrame } from './local-session-command-frame'
import { LocalSessionConnectionSubscriptions } from './local-session-connection-subscriptions'
import { establishLocalSessionHandshake } from './local-session-handshake'
import {
  LocalSessionInboundCapacityError,
  LocalSessionInboundRetention,
} from './local-session-inbound-retention'
import type { LocalSessionOutboundByteBudget } from './local-session-outbound-budget'
import { LocalSessionOutboundWriter } from './local-session-outbound-writer'
import type { LocalSessionProfileAdmissionRefreshOptions } from './local-session-profile-invalidation'
import {
  type LocalSessionAuthenticationBudget,
  type LocalSessionInboundByteBudget,
  MAX_DECODED_FRAMES_PER_CHUNK,
} from './local-session-resource-policy'
import type {
  AuthenticatedLocalSessionCaller,
  LocalSessionServerDependencies,
} from './local-session-server'
import { describeLocalSessionServerError } from './local-session-server-frame'

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000

export class LocalSessionConnection {
  private readonly inbound: LocalSessionInboundRetention
  private readonly admission = new LocalSessionAdmissionGate()
  private readonly subscriptions: LocalSessionConnectionSubscriptions
  private readonly commandControllers = new Map<string, ActiveLocalSessionCommand>()
  private readTail = Promise.resolve()
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
    this.subscriptions = new LocalSessionConnectionSubscriptions({
      dependencies,
      admission: this.admission,
      caller: () => this.caller,
      closed: () => this.closed,
      send: (frame) => this.send(frame),
      connectionFailed: () => this.socket.destroy(),
    })
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
    if (this.caller?.profileAuthority?.profileId !== profileId) return
    if (!this.admission.isFenced()) void this.admission.fence()
    this.socket.end()
  }

  fenceProfileAdmission(profileName: string): Promise<void> {
    if (this.caller?.profileAuthority?.profileName !== profileName) return Promise.resolve()
    const drained = this.admission.fence()
    for (const command of this.commandControllers.values()) {
      if (command.abortOnProfileFence) {
        command.controller.abort(new LocalSessionProfileAdmissionChangedError())
      }
    }
    return drained
  }

  refreshProfileAdmission(
    profileId?: string,
    options?: LocalSessionProfileAdmissionRefreshOptions,
  ): Promise<void> {
    const authority = this.caller?.profileAuthority
    if (!authority || (profileId && authority.profileId !== profileId)) return Promise.resolve()
    const consumesExistingFence =
      options?.consumeExistingFence === true && this.admission.hasFence()
    const drained = consumesExistingFence ? this.admission.waitForReaders() : this.admission.fence()
    const refresh = async () => {
      await drained
      const caller = this.caller
      if (!caller || !this.dependencies.refreshCaller) {
        this.admission.releaseFence()
        return
      }
      try {
        this.caller = await this.dependencies.refreshCaller(caller)
        this.admission.releaseFence()
      } catch {
        this.socket.end()
      }
    }
    return this.admission.enqueueRefresh(refresh)
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
    if (frame.kind === 'subscribe')
      return this.subscriptions.subscribe(frame.requestId, frame.after)
    return this.subscriptions.unsubscribe(frame.requestId, frame.subscriptionId)
  }

  private async handleCommand(frame: Extract<LocalSessionClientFrame, { kind: 'command' }>) {
    if (!this.caller || this.negotiatedRevision === null) return
    const controller = new AbortController()
    const activeCommand = { controller, abortOnProfileFence: false }
    this.commandControllers.set(frame.requestId, activeCommand)
    try {
      while (!this.closed) {
        await this.admission.waitUntilReady()
        const releaseGateReader = this.admission.acquireReader(this.closed)
        if (!releaseGateReader) continue
        activeCommand.abortOnProfileFence = true
        const releaseAdmissionReader = () => {
          activeCommand.abortOnProfileFence = false
          releaseGateReader()
        }
        const caller = this.caller
        const negotiatedRevision = this.negotiatedRevision
        if (!caller || negotiatedRevision === null) {
          releaseAdmissionReader()
          return
        }
        const selfCredentialMutation = isSelfProfileCredentialMutation({
          caller,
          frame,
          negotiatedRevision,
        })
        if (selfCredentialMutation) {
          activeCommand.abortOnProfileFence = false
          releaseAdmissionReader()
        }
        try {
          await executeLocalSessionCommandFrame({
            frame,
            caller,
            negotiatedRevision,
            dependencies: this.dependencies,
            signal: controller.signal,
            send: (response) => this.send(response),
            ...(!selfCredentialMutation ? { releaseAdmissionReader: releaseAdmissionReader } : {}),
          })
        } finally {
          releaseAdmissionReader()
        }
        return
      }
    } finally {
      this.commandControllers.delete(frame.requestId)
    }
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
    this.admission.close()
    this.authenticationController.abort()
    this.inbound.releasePendingFrame()
    clearTimeout(this.handshakeTimer)
    for (const command of this.commandControllers.values()) {
      command.controller.abort(new Error('Local Session client disconnected.'))
    }
    this.commandControllers.clear()
    this.subscriptions.close()
    this.releaseClientLiveness?.()
    this.releaseClientLiveness = null
  }
}
