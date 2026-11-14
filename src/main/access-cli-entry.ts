import { writeAccessCliError } from './access-cli-output'
import { flushCliOutput } from './cli-output-flush'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { env } from './env'
import { sessionCliExitCodeForError } from './session-cli-exit-status'
import { configureAppStoragePaths } from './session-data'

export function startAccessCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'access') return false
  configureAppStoragePaths(env.OPENWAGGLE_USER_DATA_DIR)
  void appLifecycle
    .whenReady()
    .then(async () => {
      const { runAccessCli } = await import('./access-cli')
      const exitCode = await runAccessCli(argv.slice(1))
      await flushCliOutput()
      appLifecycle.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      const kind = writeAccessCliError(error, argv.includes('--json'))
      await flushCliOutput().catch(() => undefined)
      appLifecycle.exit(sessionCliExitCodeForError(kind))
    })
  return true
}
