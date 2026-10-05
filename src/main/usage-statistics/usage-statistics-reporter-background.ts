/** Starts the Session Host's Usage statistics reporter as an owned background service. */
import * as SqlClient from '@effect/sql/SqlClient'
import { BUILD_CHANNEL } from '@shared/build-identity-runtime'
import type { UpdateChannel } from '@shared/types/update-channel'
import { validateUsageStatisticsContext } from '@shared/usage-statistics/validation'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import { loadUsageStatisticsInstallEvidenceTime } from '../adapters/sqlite-usage-statistics-facts'
import { UsageStatisticsTransport } from '../ports/usage-statistics-transport'
import { SettingsService } from '../services/settings-service'
import { isUsageStatisticsEnabled } from './usage-statistics-enablement'
import { readUsageStatisticsJsonFile } from './usage-statistics-json-file'
import {
  USAGE_STATISTICS_GUI_SPOOL_FILE_NAME,
  usageStatisticsHostRecorder,
} from './usage-statistics-recorder'
import { runUsageStatisticsReporter } from './usage-statistics-reporter'
import {
  decodeUsageStatisticsGuiSpool,
  EMPTY_USAGE_STATISTICS_GUI_SPOOL,
} from './usage-statistics-state-schema'

/** Lets Host startup finish before the first report. */
const STARTUP_DELAY = Duration.seconds(5)

/** This process's request context, or `undefined` for a Dev build or an unlisted platform. */
export function usageStatisticsProcessContext(input: {
  readonly appVersion: string
  readonly updateChannel: UpdateChannel
}) {
  const validated = validateUsageStatisticsContext({
    version: input.appVersion,
    build_channel: BUILD_CHANNEL,
    update_channel: input.updateChannel,
    os: process.platform,
    arch: process.arch,
  })
  return validated.ok ? validated.value : undefined
}

export const runUsageStatisticsReporterBackground = Effect.gen(function* () {
  const host = usageStatisticsHostRecorder()
  if (!host) return
  const transport = yield* UsageStatisticsTransport
  const settings = yield* SettingsService
  const sql = yield* SqlClient.SqlClient
  const reporter = runUsageStatisticsReporter({
    file: host.file,
    readGuiDays: () =>
      readUsageStatisticsJsonFile({
        filePath: host.guiSpoolPath,
        label: USAGE_STATISTICS_GUI_SPOOL_FILE_NAME,
        decode: decodeUsageStatisticsGuiSpool,
        fallback: EMPTY_USAGE_STATISTICS_GUI_SPOOL,
      }).days,
    send: transport.send,
    context: () =>
      settings.get().pipe(
        Effect.map((current) =>
          usageStatisticsProcessContext({
            appVersion: host.appVersion,
            updateChannel: current.updateChannel,
          }),
        ),
      ),
    installEvidenceTime: () =>
      loadUsageStatisticsInstallEvidenceTime.pipe(Effect.provideService(SqlClient.SqlClient, sql)),
    isEnabled: isUsageStatisticsEnabled,
    now: host.now,
    sleep: (milliseconds) => Effect.sleep(Duration.millis(milliseconds)),
  })
  yield* Effect.forkScoped(Effect.sleep(STARTUP_DELAY).pipe(Effect.zipRight(reporter)))
})
