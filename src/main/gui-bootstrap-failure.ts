/**
 * What the GUI does when startup fails: it reports the error, gives CLI recovery a moment to
 * finish installing, releases desktop services and exits, so a broken start never keeps running.
 */
import { describeError } from './error-description'
import { reportErrorBeforeExit } from './error-reporting'
import { createLogger } from './logger'
import { waitForCliSetupBeforeExit } from './services/cli-shim-startup'

const logger = createLogger('gui-bootstrap-failure')

const FAILURE_EXIT_CODE = 1
const CLI_FATAL_SETUP_WAIT_MS = 5_000

export interface BootstrapFailureInput {
  readonly error: unknown
  /** CLI recovery, which must stay available even if the Session Host or window cannot start. */
  readonly cliSetup: Promise<unknown>
  readonly cleanupDesktopServices: () => Promise<void>
  readonly exit: (code: number) => void
}

/** Quits the GUI after a failed start; never throws. */
export async function exitAfterBootstrapFailure(input: BootstrapFailureInput) {
  logger.error('Bootstrap failed; quitting for safety', describeError(input.error))
  // Sent while cleanup runs; bounded, and sends nothing unless Settings loaded first.
  const reported = reportErrorBeforeExit(input.error, 'gui')
  // Do not terminate the process while CLI recovery is still being installed.
  if (!(await waitForCliSetupBeforeExit(input.cliSetup, CLI_FATAL_SETUP_WAIT_MS))) {
    logger.warn('CLI setup did not finish before fatal startup cleanup')
  }
  try {
    await input.cleanupDesktopServices()
  } catch (cleanupError) {
    logger.error(
      'Bootstrap native cleanup failed; ownership remains quarantined',
      describeError(cleanupError),
    )
  }
  await reported
  input.exit(FAILURE_EXIT_CODE)
}
