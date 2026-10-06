import { matchBy } from '@diegogbrisa/ts-match'
import { PRODUCT_NAME } from '@shared/build-identity-runtime'
import type { UpdateStatus } from '@shared/types/updater'

interface StatusRow {
  subtitle: string
  subtitleClass: string
  dotClass: string | null
}

const UP_TO_DATE: StatusRow = {
  subtitle: 'You are up to date',
  subtitleClass: 'text-text-tertiary',
  dotClass: null,
}

/** The About & Updates status line for an updater status. */
export function getStatusRow(status: UpdateStatus) {
  return matchBy(status, 'type')
    .with('idle', () => UP_TO_DATE)
    .with('not-available', () => UP_TO_DATE)
    .with('checking', () => ({
      subtitle: 'Checking for updates…',
      subtitleClass: 'text-text-tertiary',
      dotClass: null,
    }))
    .with('available', (s) => ({
      subtitle: `Downloading v${s.version}…`,
      subtitleClass: 'text-info-text',
      dotClass: 'bg-info',
    }))
    .with('downloading', (s) => ({
      subtitle: `Downloading v${s.version}… ${Math.round(s.percent)}%`,
      subtitleClass: 'text-info-text',
      dotClass: 'bg-info',
    }))
    .with('downloaded', (s) => {
      if (s.waitingForRuns !== undefined && s.waitingForRuns > 0) {
        return {
          subtitle: `v${s.version} will install when ${s.waitingForRuns === 1 ? '1 agent run finishes' : `${s.waitingForRuns} agent runs finish`}`,
          subtitleClass: 'text-success',
          dotClass: 'bg-success',
        }
      }
      if (s.installFailure) {
        return {
          subtitle: s.installFailure,
          subtitleClass: 'text-error-text',
          dotClass: 'bg-error',
        }
      }
      return {
        subtitle: `v${s.version} ready to install`,
        subtitleClass: 'text-success',
        dotClass: 'bg-success',
      }
    })
    .with('installing', (s) => ({
      subtitle: `Installing v${s.version}. ${PRODUCT_NAME} reopens when it is done`,
      subtitleClass: 'text-info-text',
      dotClass: null,
    }))
    .with('error', () => ({
      subtitle: 'Update check failed',
      subtitleClass: 'text-error-text',
      dotClass: 'bg-error',
    }))
    .exhaustive()
}
