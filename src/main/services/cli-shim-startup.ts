import type { CliShimMutationResult, CliShimStatus } from '@shared/types/cli-shim'
import { app } from 'electron'
import { describeError } from '../error-description'
import { createLogger } from '../logger'
import {
  createAppCliShimService,
  type createCliShimService,
  ensureCliShimInstalled,
} from './cli-shim-service'

type SetupService = Pick<ReturnType<typeof createCliShimService>, 'status' | 'install'>
const CLI_SETUP_STATUS_WAIT_MS = 5_000
const logger = createLogger('cli-shim-startup')

/** A status read during first-launch setup waits for the installation result. */
export function createCliShimSetupGate(
  service: SetupService,
  statusWaitMs = CLI_SETUP_STATUS_WAIT_MS,
) {
  let setup: Promise<CliShimMutationResult> | null = null
  return {
    begin() {
      setup ??= ensureCliShimInstalled(service)
      return setup
    },
    async status(): Promise<CliShimStatus> {
      if (setup && !(await waitForCliSetupBeforeExit(setup, statusWaitMs))) {
        return {
          management: 'user-shim',
          state: 'unavailable',
          commandPath: null,
          onPath: false,
          detail: 'CLI setup is still running. Reopen Settings to check again.',
        }
      }
      return service.status()
    },
  }
}

let appCliSetupGate: ReturnType<typeof createCliShimSetupGate> | null = null

function getAppCliSetupGate() {
  appCliSetupGate ??= createCliShimSetupGate(createAppCliShimService())
  return appCliSetupGate
}

export function beginAppCliShimSetup() {
  return getAppCliSetupGate().begin()
}

/** Begins CLI setup when `enabled`, logging rather than throwing on failure. */
export function beginAppCliShimSetupWhen(enabled: boolean): Promise<void> {
  if (!enabled) return Promise.resolve()
  return beginAppCliShimSetup()
    .then((result) => {
      if (!result.ok)
        logger.warn('Could not make the bundled CLI available', { detail: result.error })
    })
    .catch((error: unknown) => logger.warn('CLI setup failed', describeError(error)))
}

export function getAppCliShimStatus(isPackaged = app.isPackaged) {
  if (!isPackaged) return Promise.resolve(null)
  return getAppCliSetupGate().status()
}

/** A broken GUI must still clean up and exit if the independent CLI helper stalls. */
export async function waitForCliSetupBeforeExit(setup: Promise<unknown>, timeoutMs: number) {
  let timer!: ReturnType<typeof setTimeout>
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([
      setup.then(
        () => true,
        () => true,
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}
