import { flushCliOutput } from './cli-output-flush'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'

const FAILURE_EXIT_CODE = 1

export function startMcpCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'mcp') return false

  configureAppStoragePaths(env.OPENWAGGLE_USER_DATA_DIR)
  void appLifecycle
    .whenReady()
    .then(async () => {
      // This CLI loads Settings and builds Pi runtimes in-process, as the Host does.
      const { installPiRuntimeIntegration } = await import('./runtime-pi-integration')
      installPiRuntimeIntegration()
      const { runMcpCli } = await import('./mcp-cli')
      const exitCode = await runMcpCli(argv.slice(1))
      await flushCliOutput()
      appLifecycle.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
      await flushCliOutput().catch(() => undefined)
      appLifecycle.exit(FAILURE_EXIT_CODE)
    })
  return true
}
