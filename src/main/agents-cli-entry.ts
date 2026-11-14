import { writeAgentsCliError } from './agents-cli-output'
import { cliExitCodeForKind } from './cli-error'
import { flushCliOutput } from './cli-output-flush'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { env } from './env'
import { configureAppStoragePaths } from './session-data'

export function startAgentsCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'agents') return false
  configureAppStoragePaths(env.OPENWAGGLE_USER_DATA_DIR)
  void appLifecycle
    .whenReady()
    .then(async () => {
      // This CLI loads Settings and builds Pi runtimes in-process, as the Host does.
      const { installPiRuntimeIntegration } = await import('./runtime-pi-integration')
      installPiRuntimeIntegration()
      const { runAgentsCli } = await import('./agents-cli')
      const exitCode = await runAgentsCli(argv.slice(1))
      await flushCliOutput()
      appLifecycle.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      const kind = writeAgentsCliError(
        error,
        argv.includes('--json'),
        process.stderr.write.bind(process.stderr),
      )
      await flushCliOutput().catch(() => undefined)
      appLifecycle.exit(cliExitCodeForKind(kind))
    })
  return true
}
