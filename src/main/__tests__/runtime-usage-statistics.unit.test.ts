import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { describe, expect, it } from 'vitest'
import { UsageStatisticsRecorder } from '../ports/usage-statistics-recorder'
import { UsageStatisticsTransport } from '../ports/usage-statistics-transport'
import { installSettingsStoreTestLifecycle } from '../store/__tests__/settings-test-harness'

describe('production app runtime', () => {
  installSettingsStoreTestLifecycle()

  // Application and IPC code look the recorder up optionally, so a runtime without it would
  // silently record nothing.
  it('provides the Usage statistics recorder and transport', async () => {
    const { runAppEffect } = await import('../runtime')

    const [recorder, transport] = await runAppEffect(
      Effect.all([
        Effect.serviceOption(UsageStatisticsRecorder),
        Effect.serviceOption(UsageStatisticsTransport),
      ]),
    )

    expect(Option.isSome(recorder)).toBe(true)
    expect(Option.isSome(transport)).toBe(true)
  })
})
