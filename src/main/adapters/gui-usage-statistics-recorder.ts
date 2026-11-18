/**
 * The desktop window's Usage statistics recorder: it records the window's own observations into
 * its observations file (usage-statistics-gui.ts). Runs belong to the Session Host, which records
 * their start and finish itself, so those two do nothing here and no database is read (A-F5).
 */
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { UsageStatisticsRecorder } from '../ports/usage-statistics-recorder'
import { recordUsageStatistics } from '../usage-statistics/usage-statistics-recorder'

export const GuiUsageStatisticsRecorderLive = Layer.succeed(UsageStatisticsRecorder, {
  record: (observation) => Effect.sync(() => recordUsageStatistics(observation)),
  runStarted: () => Effect.void,
  runFinished: () => Effect.void,
})
