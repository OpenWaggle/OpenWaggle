import { flushCliOutput } from './cli-output-flush'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'

const FAILURE_EXIT_CODE = 1

export function startUpdateCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'update') return false
  configureAppStoragePaths(env.OPENWAGGLE_USER_DATA_DIR)
  void appLifecycle
    .whenReady()
    .then(async () => {
      const { runUpdateCli } = await import('./update-cli')
      const result = await runUpdateCli(argv.slice(1))
      await flushCliOutput()
      if (!result.updaterOwnsExit) appLifecycle.exit(result.exitCode)
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      await flushCliOutput().catch(() => undefined)
      appLifecycle.exit(FAILURE_EXIT_CODE)
    })
  return true
}
