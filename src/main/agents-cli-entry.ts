import { app } from 'electron'
import { writeAgentsCliError } from './agents-cli-output'
import { flushCliOutput } from './cli-output-flush'
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
      const exitCode = await runAgentsCli(argv.slice(1))
      await flushCliOutput()
      app.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      writeAgentsCliError(error, argv.includes('--json'), process.stderr.write.bind(process.stderr))
      await flushCliOutput().catch(() => undefined)
      app.exit(FAILURE_EXIT_CODE)
    })
  return true
}
