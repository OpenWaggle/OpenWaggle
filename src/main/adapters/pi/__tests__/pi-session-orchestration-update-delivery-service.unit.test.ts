import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeRuns } from '../../../application/active-session-runs'
import { SessionOrchestrationUpdateDeliveryService } from '../../../ports/session-orchestration-update-delivery-service'
import {
  SessionOrchestrationUpdateRepository,
  type SessionOrchestrationUpdateRepositoryShape,
} from '../../../ports/session-orchestration-update-repository'

const mocks = vi.hoisted(() => ({
  deliver: vi.fn<(runId: string) => boolean>(),
  deliverSpecifications: vi.fn<(runId: string) => boolean>(),
}))

vi.mock('../orchestration-update-extension', () => ({
  deliverOrchestrationUpdates: (runId: string) => mocks.deliver(runId),
}))
vi.mock('../delegation-specification-update-extension', () => ({
  deliverDelegationSpecificationUpdates: (runId: string) => mocks.deliverSpecifications(runId),
}))

import { PiSessionOrchestrationUpdateDeliveryServiceLive } from '../pi-session-orchestration-update-delivery-service'

const parentSessionId = SessionId('session-parent')

function serviceLayer() {
  return PiSessionOrchestrationUpdateDeliveryServiceLive.pipe(
    Layer.provide(
      Layer.succeed(
        SessionOrchestrationUpdateRepository,
        fromPartial<SessionOrchestrationUpdateRepositoryShape>({
          listPending: () => Effect.succeed([]),
          listPendingSpecifications: () => Effect.succeed([]),
        }),
      ),
    ),
  )
}

function deliverPending() {
  return Effect.runPromise(
    SessionOrchestrationUpdateDeliveryService.pipe(
      Effect.flatMap((service) => service.deliverPendingToActiveRun({ parentSessionId })),
      Effect.provide(serviceLayer()),
    ),
  )
}

function deliverPendingSpecifications() {
  return Effect.runPromise(
    SessionOrchestrationUpdateDeliveryService.pipe(
      Effect.flatMap((service) =>
        service.deliverPendingSpecificationsToActiveRun({ workerSessionId: parentSessionId }),
      ),
      Effect.provide(serviceLayer()),
    ),
  )
}

describe('PiSessionOrchestrationUpdateDeliveryService', () => {
  afterEach(() => {
    activeRuns.delete(parentSessionId)
    mocks.deliver.mockReset()
    mocks.deliverSpecifications.mockReset()
  })

  // The update stays pending and the parent is asked for a wake, instead of a defect in the
  // command that recorded the update.
  it('reports a delivery Pi refused as not delivered', async () => {
    activeRuns.register(parentSessionId, new AbortController(), { runId: 'run-parent' })
    mocks.deliver.mockImplementation(() => {
      throw new Error('Extension runtime not initialized')
    })

    await expect(deliverPending()).resolves.toBe(false)
    expect(mocks.deliver).toHaveBeenCalledWith('run-parent')
  })

  it('reports a specification update Pi refused as not delivered', async () => {
    activeRuns.register(parentSessionId, new AbortController(), { runId: 'run-worker' })
    mocks.deliverSpecifications.mockImplementation(() => {
      throw new Error('Extension runtime not initialized')
    })

    await expect(deliverPendingSpecifications()).resolves.toBe(false)
    expect(mocks.deliverSpecifications).toHaveBeenCalledWith('run-worker')
  })
})
