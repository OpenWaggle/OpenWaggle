import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import type { UsageStatisticsObservation } from '../../domain/usage-statistics/usage-statistics-observations'
import { UsageStatisticsRecorder } from '../../ports/usage-statistics-recorder'
import { recordUsageStatisticsObservation } from '../usage-statistics-recording'

function recorderRecordingInto(observations: UsageStatisticsObservation[]) {
  return UsageStatisticsRecorder.of({
    record: (observation) => Effect.sync(() => void observations.push(observation)),
    runStarted: () => Effect.void,
    runFinished: () => Effect.void,
  })
}

describe('Usage statistics recording through the port', () => {
  it('records an observation with the runtime’s recorder', async () => {
    const observations: UsageStatisticsObservation[] = []

    await Effect.runPromise(
      recordUsageStatisticsObservation({ kind: 'feature', flag: 'terminal' }).pipe(
        Effect.provideService(UsageStatisticsRecorder, recorderRecordingInto(observations)),
      ),
    )

    expect(observations).toEqual([{ kind: 'feature', flag: 'terminal' }])
  })

  it('does nothing in a runtime without a recorder and never fails its caller', async () => {
    await expect(
      Effect.runPromise(recordUsageStatisticsObservation({ kind: 'app-opened' })),
    ).resolves.toBeUndefined()

    const broken = UsageStatisticsRecorder.of({
      record: () => Effect.die(new Error('recorder broke')),
      runStarted: () => Effect.void,
      runFinished: () => Effect.void,
    })
    await expect(
      Effect.runPromise(
        recordUsageStatisticsObservation({ kind: 'app-opened' }).pipe(
          Effect.provideService(UsageStatisticsRecorder, broken),
        ),
      ),
    ).resolves.toBeUndefined()
  })
})
