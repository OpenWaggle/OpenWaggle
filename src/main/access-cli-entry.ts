import { app } from 'electron'
import { writeAccessCliError } from './access-cli-output'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { sessionCliExitCodeForError } from './session-cli-exit-status'
import { configureAppStoragePaths } from './session-data'

export function startAccessCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'access') return false
  configureAppStoragePaths(app, env.OPENWAGGLE_USER_DATA_DIR)
  void app
    .whenReady()
    .then(async () => {
      const { runAccessCli } = await import('./access-cli')
      const exitCode = await runAccessCli(argv.slice(1))
      await flushCliOutput()
      app.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      const kind = writeAccessCliError(error, argv.includes('--json'))
      await flushCliOutput().catch(() => undefined)
      app.exit(sessionCliExitCodeForError(kind))
    })
  return true
}
