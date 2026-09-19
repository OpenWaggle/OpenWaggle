import { randomUUID } from 'node:crypto'
import type {
  DesktopFenceRecord,
  DesktopMutationScope,
  DesktopServiceCommand,
  DesktopServiceResult,
} from '@shared/types/desktop-service'
import * as Effect from 'effect/Effect'
import type { DesktopFenceRepositoryShape } from '../ports/desktop-fence-repository'
import type { DesktopOwnerRepositoryShape } from '../ports/desktop-owner-repository'
import type { DesktopServiceCommandQueue } from './desktop-service-command-queue'
import {
  DesktopOperationIndeterminateError,
  desktopUnavailableError,
} from './desktop-service-errors'
import type { DesktopServiceLeases } from './desktop-service-leases'
import { desktopCleanupMatchesFence, desktopScopesOverlap } from './desktop-service-policy'

export const DESKTOP_FENCE_RELEASE_TIMEOUT_MS = 10_000

export async function isDesktopNativeFree(owners: DesktopOwnerRepositoryShape) {
  const owner = await Effect.runPromise(owners.get())
  return owner === null || owner.state === 'closed'
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error('Desktop mutation failed.')
}

export class DesktopServiceFences {
  private readonly live = new Set<string>()

  constructor(
    private readonly input: {
      readonly leases: DesktopServiceLeases
      readonly fences: DesktopFenceRepositoryShape
      readonly owners: DesktopOwnerRepositoryShape
      readonly queue: DesktopServiceCommandQueue
      readonly execute: (
        command: DesktopServiceCommand,
        signal: AbortSignal,
      ) => Promise<DesktopServiceResult>
    },
  ) {}

  hasToken(token: string) {
    return this.live.has(token)
  }

  cleanupAllowed(command: DesktopServiceCommand, records: readonly DesktopFenceRecord[]) {
    return records.some(
      (record) =>
        record.hostInstanceId === this.input.leases.hostInstanceId() &&
        this.live.has(record.token) &&
        desktopCleanupMatchesFence(command, record),
    )
  }

  private reserve(scope: DesktopMutationScope, signal: AbortSignal) {
    return this.input.leases.admit(async () => {
      signal.throwIfAborted()
      const owner = this.input.leases.current()
      if (owner) {
        this.input.leases.require(owner.id, true)
        if (owner.draining) throw desktopUnavailableError()
      }
      if (!owner && !(await isDesktopNativeFree(this.input.owners))) throw desktopUnavailableError()
      const existing = await this.input.leases.readFences()
      if (
        existing.some(
          (record) => record.state === 'active' && desktopScopesOverlap(scope, record.scope),
        )
      ) {
        throw new Error('A desktop mutation already owns this scope. Finish or recover it first.')
      }
      const record: DesktopFenceRecord & { readonly state: 'active' } = {
        token: randomUUID(),
        hostInstanceId: this.input.leases.hostInstanceId(),
        scope,
        state: 'active',
      }
      await Effect.runPromise(this.input.fences.insert(record))
      this.live.add(record.token)
      this.input.queue.wake()
      return { record, offline: owner === undefined }
    })
  }

  private async release(record: DesktopFenceRecord) {
    await Effect.runPromise(this.input.fences.markReleased(record.token, record.hostInstanceId))
    this.live.delete(record.token)
    this.input.queue.wake()
    try {
      await this.settleReleasedFence(record)
    } catch (error) {
      if (error instanceof DesktopOperationIndeterminateError) throw error
      throw new DesktopOperationIndeterminateError({ cause: error })
    }
  }

  private async settleReleasedFence(record: DesktopFenceRecord) {
    // Serialize reclamation against GUI registration: never remove a receipt the GUI saw.
    const leaseId = await this.input.leases.admit(async () => {
      if (!this.input.leases.current() && (await isDesktopNativeFree(this.input.owners))) {
        await Effect.runPromise(
          this.input.fences.removeReleased(record.token, record.hostInstanceId),
        )
        return undefined
      }
      const owner = this.input.leases.current()
      if (!owner) throw new DesktopOperationIndeterminateError()
      return owner.id
    })
    if (leaseId !== undefined) await this.waitForReleaseAcknowledgement(record, leaseId)
  }

  private async waitForReleaseAcknowledgement(record: DesktopFenceRecord, leaseId: string) {
    const deadline = Date.now() + DESKTOP_FENCE_RELEASE_TIMEOUT_MS
    const signal = new AbortController().signal
    while (true) {
      const revision = this.input.queue.revision()
      const records = await this.input.leases.readFences()
      const pending = records.find((candidate) => candidate.token === record.token)
      // Only exact GUI acknowledgement (or proven native-free reclamation) removes
      // a released journal record. Mutation success must not race its native fence.
      if (!pending) return
      if (
        pending.hostInstanceId !== record.hostInstanceId ||
        pending.state !== 'released' ||
        this.input.leases.current()?.id !== leaseId ||
        Date.now() >= deadline
      ) {
        throw new DesktopOperationIndeterminateError()
      }
      await this.input.queue.wait(signal, revision, deadline - Date.now())
    }
  }

  runWithMutationFence<A, E, R>(scope: DesktopMutationScope, operation: Effect.Effect<A, E, R>) {
    const reserve = (signal: AbortSignal) => this.reserve(scope, signal)
    const execute = this.input.execute
    const release = (record: DesktopFenceRecord) => this.release(record)
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        // Persist and install cleanup atomically against interruption. Only this short
        // reservation is protected; waiting for the GUI and running the mutation are not.
        const admission = yield* Effect.tryPromise({ try: reserve, catch: asError })
        const acquire = admission.offline
          ? Effect.void
          : Effect.tryPromise({
              try: (signal) =>
                execute(
                  { service: 'fence', operation: 'acquire', record: admission.record },
                  signal,
                ),
              catch: asError,
            })
        const result = yield* Effect.exit(restore(acquire.pipe(Effect.zipRight(operation))))
        yield* Effect.tryPromise({ try: () => release(admission.record), catch: asError })
        return yield* result
      }),
    )
  }
}
