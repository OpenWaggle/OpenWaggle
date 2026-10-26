import { app } from 'electron'
import { cliExitCodeForKind } from './cli-error'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { writeRecoveryCliError } from './recovery-cli-output'
import { configureAppStoragePaths } from './session-data'

export function startRecoveryCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'recovery') return false
  const reportFailure = async (error: unknown) => {
    const kind = writeRecoveryCliError(error, argv.includes('--json'))
    await flushCliOutput().catch(() => undefined)
    app.exit(cliExitCodeForKind(kind))
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
