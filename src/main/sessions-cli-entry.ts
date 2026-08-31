import { app } from 'electron'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'
import { writeSessionsCliError } from './sessions-cli-output'

const FAILURE_EXIT_CODE = 1

export function startSessionsCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'sessions') return false
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      const { runSessionsCli } = await import('./sessions-cli')
      const exitCode = await runSessionsCli(argv.slice(1))
      await flushCliOutput()
      app.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      writeSessionsCliError(error, argv.includes('--json') || argv.includes('--jsonl'))
      await flushCliOutput().catch(() => undefined)
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
