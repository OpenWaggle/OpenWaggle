import { app } from 'electron'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { writeRecoveryCliError } from './recovery-cli-output'
import { configureAppStoragePaths } from './session-data'

const FAILURE_EXIT_CODE = 1

export function startRecoveryCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'recovery') return false
  const reportFailure = async (error: unknown) => {
    writeRecoveryCliError(error, argv.includes('--json'))
    await flushCliOutput().catch(() => undefined)
    app.exit(FAILURE_EXIT_CODE)
  }
  try {
    configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
    void app
      .whenReady()
      .then(async () => {
        const { runRecoveryCli } = await import('./recovery-cli')
        const exitCode = await runRecoveryCli(argv.slice(1))
        await flushCliOutput()
        app.exit(exitCode)
      })
      .catch(reportFailure)
  } catch (error) {
    void reportFailure(error)
  }
  return true
}
