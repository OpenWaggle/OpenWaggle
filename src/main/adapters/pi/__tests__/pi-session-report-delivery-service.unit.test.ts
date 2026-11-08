import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeRuns } from '../../../application/active-session-runs'
import { SessionReportDeliveryService } from '../../../ports/session-report-delivery-service'
import {
  SessionReportRepository,
  type SessionReportRepositoryShape,
} from '../../../ports/session-report-repository'

const mocks = vi.hoisted(() => ({ deliver: vi.fn<(runId: string) => boolean>() }))

vi.mock('../peer-agent-report-extension', () => ({
  deliverPeerAgentReports: (runId: string) => mocks.deliver(runId),
}))

import { PiSessionReportDeliveryServiceLive } from '../pi-session-report-delivery-service'

const targetSessionId = SessionId('session-target')

describe('PiSessionReportDeliveryService', () => {
  afterEach(() => {
    activeRuns.delete(targetSessionId)
    mocks.deliver.mockReset()
  })

  // The report stays pending for the next Run, instead of a defect in the command that sent it.
  it('reports a delivery Pi refused as not delivered', async () => {
    activeRuns.register(targetSessionId, new AbortController(), { runId: 'run-target' })
    mocks.deliver.mockImplementation(() => {
      throw new Error('Extension runtime not initialized')
    })
    const layer = PiSessionReportDeliveryServiceLive.pipe(
      Layer.provide(
        Layer.succeed(
          SessionReportRepository,
          fromPartial<SessionReportRepositoryShape>({ listPending: () => Effect.succeed([]) }),
        ),
      ),
    )

    await expect(
      Effect.runPromise(
        SessionReportDeliveryService.pipe(
          Effect.flatMap((service) => service.deliverPendingToActiveRun({ targetSessionId })),
          Effect.provide(layer),
        ),
      ),
    ).resolves.toBe(false)
    expect(mocks.deliver).toHaveBeenCalledWith('run-target')
  })
})
