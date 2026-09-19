import { app } from 'electron'
import { flushCliOutput } from './cli-output-flush'
import { env } from './env'
import { sessionCliExitCodeForError } from './session-cli-exit-status'
import { configureAppStoragePaths } from './session-data'
import { writeSessionsCliError } from './sessions-cli-output'

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
      const kind = writeSessionsCliError(error, argv.includes('--json') || argv.includes('--jsonl'))
      await flushCliOutput().catch(() => undefined)
      app.exit(sessionCliExitCodeForError(kind))
    })
  return true
}
