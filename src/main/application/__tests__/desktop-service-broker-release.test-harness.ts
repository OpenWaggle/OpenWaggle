import type { DesktopFenceRecord } from '@shared/types/desktop-service'
import { Effect } from 'effect'
import { vi } from 'vitest'
import type { brokerHarness } from './desktop-service-broker.test-harness'

type BrokerFixture = ReturnType<typeof brokerHarness>

export function waitForReleasedFence(instance: BrokerFixture) {
  return vi.waitFor(() => {
    const record = [...instance.records.values()].find(
      (candidate) => candidate.state === 'released',
    )
    if (!record) throw new Error('Expected a released desktop fence.')
    return record
  })
}

export function acknowledgeReleasedFence(
  instance: BrokerFixture,
  leaseId: string,
  record: DesktopFenceRecord,
) {
  return Effect.runPromise(
    instance.broker.handleGuiRequest({
      operation: 'acknowledgeReleased',
      leaseId,
      token: record.token,
      hostInstanceId: record.hostInstanceId,
    }),
  )
}
