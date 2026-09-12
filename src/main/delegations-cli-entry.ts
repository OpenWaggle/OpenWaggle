import { app } from 'electron'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'

const FAILURE_EXIT_CODE = 1

export function startDelegationsCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'delegations') return false
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      const { runDelegationsCli } = await import('./delegations-cli')
      const exitCode = await runDelegationsCli(argv.slice(1))
      await flushCliOutput()
      app.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      await flushCliOutput().catch(() => undefined)
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
