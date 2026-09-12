import { randomUUID } from 'node:crypto'
import {
  DESKTOP_SERVICE_LIMITS,
  type DesktopServiceRequest,
  type DesktopServiceResponse,
} from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import type { DesktopFenceRepositoryShape } from '../ports/desktop-fence-repository'
import type { DesktopOwnerRepositoryShape } from '../ports/desktop-owner-repository'
import type { DesktopServiceCommandQueue } from './desktop-service-command-queue'
import { desktopUnavailableError } from './desktop-service-errors'

interface DesktopLease {
  readonly id: string
  readonly guiInstanceId: string
  lastSeen: number
  ready: boolean
  polling: boolean
  draining: boolean
}

export class DesktopServiceLeases {
  private lease: DesktopLease | undefined
  private closed = false
  private admissionTail = Promise.resolve()
  private boundHostInstanceId: string | undefined

  constructor(
    private readonly input: {
      readonly getHostInstanceId: () => string
      readonly fences: DesktopFenceRepositoryShape
      readonly owners: DesktopOwnerRepositoryShape
      readonly queue: DesktopServiceCommandQueue
    },
  ) {}

  admit<A>(operation: () => Promise<A>): Promise<A> {
    const current = this.admissionTail.then(operation)
    // A rejected admission must not poison later independent admissions.
    this.admissionTail = current.then(
      () => undefined,
      () => undefined,
    )
    return current
  }

  hostInstanceId() {
    const current = this.input.getHostInstanceId()
    if (
      !current ||
      (this.boundHostInstanceId !== undefined && this.boundHostInstanceId !== current)
    ) {
      throw new Error('Desktop services are not bound to the current Session Host instance.')
    }
    this.boundHostInstanceId = current
    return current
  }

  readFences() {
    return Effect.runPromise(this.input.fences.getAll())
  }

  current() {
    if (this.closed) throw desktopUnavailableError()
    if (this.lease && Date.now() - this.lease.lastSeen > DESKTOP_SERVICE_LIMITS.leaseTimeoutMs)
      this.revoke()
    return this.lease
  }

  require(id?: string, ready = false) {
    const lease = this.current()
    if (!lease) throw desktopUnavailableError()
    if (id !== undefined && lease.id !== id) throw new Error('The desktop lease is stale.')
    if (ready && !lease.ready) throw desktopUnavailableError()
    return lease
  }

  private revoke() {
    if (this.lease) this.input.queue.revoke(this.lease.id)
    this.lease = undefined
  }

  private async register(guiInstanceId: string): Promise<DesktopServiceResponse> {
    return this.admit(async () => {
      const current = this.current()
      const durable = await Effect.runPromise(this.input.owners.get())
      if (durable?.state === 'active' && durable.guiInstanceId !== guiInstanceId) {
        return { operation: 'quarantined', reason: 'previous-owner-unclean' }
      }
      if (current && current.guiInstanceId !== guiInstanceId)
        throw new Error('Another OpenWaggle desktop owns the current lease.')
      await Effect.runPromise(
        this.input.owners.activate({ guiInstanceId, hostInstanceId: this.hostInstanceId() }),
      )
      const owner = current ?? {
        id: randomUUID(),
        guiInstanceId,
        lastSeen: Date.now(),
        ready: false,
        polling: false,
        draining: false,
      }
      this.lease = owner
      owner.ready = false
      owner.lastSeen = Date.now()
      const fences = await this.readFences()
      this.require(owner.id)
      return {
        operation: 'register',
        leaseId: owner.id,
        hostInstanceId: this.hostInstanceId(),
        fences,
      }
    })
  }

  private async markClosed(
    request: Extract<DesktopServiceRequest, { operation: 'markClosed' }>,
  ): Promise<DesktopServiceResponse> {
    return this.admit(async () => {
      const current = this.current()
      const durable = await Effect.runPromise(this.input.owners.get())
      if (
        current ||
        !this.input.queue.isIdle() ||
        !durable ||
        durable.guiInstanceId !== request.guiInstanceId ||
        durable.hostInstanceId !== request.hostInstanceId
      ) {
        throw new Error('The clean desktop receipt does not match the disconnected native owner.')
      }
      const fences = await this.readFences()
      if (fences.some((fence) => fence.state === 'active')) {
        throw new Error(
          'Outstanding desktop mutations must be reconciled before recording clean shutdown.',
        )
      }
      // The exact durable old Host identity remains valid after a Host restart. GUI proof is
      // submitted only after actual native disposal; a transport disconnect is never this proof.
      await Effect.runPromise(
        this.input.owners.markClosed(request.guiInstanceId, request.hostInstanceId),
      )
      return { operation: 'markClosed', accepted: true }
    })
  }

  private async poll(leaseId: string, signal: AbortSignal): Promise<DesktopServiceResponse> {
    const owner = this.require(leaseId, true)
    if (owner.polling) throw new Error('This desktop already has a pending poll.')
    owner.polling = true
    owner.lastSeen = Date.now()
    try {
      const revision = this.input.queue.revision()
      let commands = this.input.queue.take(leaseId)
      if (commands.length === 0 && this.input.queue.cancelledFor(leaseId).length === 0) {
        await this.input.queue.wait(signal, revision)
        signal.throwIfAborted()
        this.require(leaseId, true)
        commands = this.input.queue.take(leaseId)
      }
      const fences = await this.readFences()
      this.require(leaseId, true)
      owner.lastSeen = Date.now()
      return {
        operation: 'poll',
        commands,
        cancelledCommandIds: this.input.queue.cancelledFor(leaseId),
        fences,
      }
    } finally {
      owner.polling = false
    }
  }

  async handle(
    request: DesktopServiceRequest,
    signal: AbortSignal,
  ): Promise<DesktopServiceResponse> {
    if (request.operation === 'register') return this.register(request.guiInstanceId)
    if (request.operation === 'markClosed') return this.markClosed(request)
    if (request.operation === 'disconnect' && !this.current())
      return { operation: 'disconnect', accepted: true }
    const owner = this.require(request.leaseId)
    owner.lastSeen = Date.now()
    if (request.operation === 'poll') return this.poll(request.leaseId, signal)
    if (request.operation === 'ready') {
      return this.admit(async () => {
        const records = await this.readFences()
        this.require(owner.id)
        const active = records
          .filter((record) => record.state === 'active')
          .map((record) => record.token)
        const tokens = new Set(request.fenceTokens)
        if (
          tokens.size !== request.fenceTokens.length ||
          tokens.size !== active.length ||
          active.some((token) => !tokens.has(token))
        ) {
          throw new Error(
            'Desktop fences changed during attachment. Reconcile before accepting commands.',
          )
        }
        owner.ready = true
        return { operation: 'ready', accepted: true }
      })
    }
    if (request.operation === 'complete')
      return {
        operation: 'complete',
        accepted: this.input.queue.complete(owner.id, request.completion),
      }
    if (request.operation === 'acknowledgeReleased') {
      await Effect.runPromise(
        this.input.fences.removeReleased(request.token, request.hostInstanceId),
      )
      this.require(owner.id)
      return { operation: 'acknowledgeReleased', accepted: true }
    }
    if (request.operation === 'heartbeat') return { operation: 'heartbeat', accepted: true }
    if (request.operation === 'prepareDisconnect' || request.operation === 'resumeDesktop') {
      return this.admit(async () => {
        this.require(owner.id)
        owner.draining = request.operation === 'prepareDisconnect'
        this.input.queue.wake()
        if (request.operation === 'prepareDisconnect')
          return { operation: 'prepareDisconnect', accepted: true, fences: await this.readFences() }
        return { operation: request.operation, accepted: true }
      })
    }
    this.revoke()
    return { operation: 'disconnect', accepted: true }
  }

  close() {
    this.closed = true
    this.revoke()
  }
}
