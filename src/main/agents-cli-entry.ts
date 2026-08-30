import { app } from 'electron'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'

const FAILURE_EXIT_CODE = 1

export function startAgentsCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'agents') return false
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      const { runAgentsCli } = await import('./agents-cli')
      app.exit(await runAgentsCli(argv.slice(1)))
    })
    .catch((error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
