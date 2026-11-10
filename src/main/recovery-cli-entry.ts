import { cliExitCodeForKind } from './cli-error'
import { flushCliOutput } from './cli-output-flush'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { env } from './env'
import { writeRecoveryCliError } from './recovery-cli-output'
import { configureAppStoragePaths } from './session-data'

export function startRecoveryCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'recovery') return false
  const reportFailure = async (error: unknown) => {
    const kind = writeRecoveryCliError(error, argv.includes('--json'))
    await flushCliOutput().catch(() => undefined)
    appLifecycle.exit(cliExitCodeForKind(kind))
  }
  try {
    configureAppStoragePaths(env.OPENWAGGLE_USER_DATA_DIR)
    void appLifecycle
      .whenReady()
      .then(async () => {
        const { runRecoveryCli } = await import('./recovery-cli')
        const exitCode = await runRecoveryCli(argv.slice(1))
        await flushCliOutput()
        appLifecycle.exit(exitCode)
      })
      .catch(reportFailure)
  } catch (error) {
    void reportFailure(error)
  }
  return true
}
