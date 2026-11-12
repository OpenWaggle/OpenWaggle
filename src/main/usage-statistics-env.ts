import type { UsageStatisticsEnablementInput } from '@shared/usage-statistics/enablement'
import { env } from './env'

/** The environment values that decide Usage statistics in this process, leaving out unset ones. */
export function usageStatisticsEnv(): UsageStatisticsEnablementInput['env'] {
  return {
    ...(env.DO_NOT_TRACK === undefined ? {} : { DO_NOT_TRACK: env.DO_NOT_TRACK }),
    ...(env.PI_TELEMETRY === undefined ? {} : { PI_TELEMETRY: env.PI_TELEMETRY }),
    ...(env.CI === undefined ? {} : { CI: env.CI }),
    ...(env.OPENWAGGLE_AUTOMATION === undefined
      ? {}
      : { OPENWAGGLE_AUTOMATION: env.OPENWAGGLE_AUTOMATION }),
  }
}
