import { app } from 'electron'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'

const FAILURE_EXIT_CODE = 1

export function startUpdateCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'update') return false
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      const { runUpdateCli } = await import('./update-cli')
      const result = await runUpdateCli(argv.slice(1))
      await flushCliOutput()
      if (!result.updaterOwnsExit) app.exit(result.exitCode)
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      await flushCliOutput().catch(() => undefined)
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
