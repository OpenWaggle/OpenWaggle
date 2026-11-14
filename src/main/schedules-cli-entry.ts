import { flushCliOutput } from './cli-output-flush'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { env } from './env'
import { sessionCliExitCodeForError } from './session-cli-exit-status'
import { configureAppStoragePaths } from './session-data'
import { writeSessionsCliError } from './sessions-cli-output'

export function startSchedulesCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== 'schedules') return false
  configureAppStoragePaths(env.OPENWAGGLE_USER_DATA_DIR)
  void appLifecycle
    .whenReady()
    .then(async () => {
      const { runSchedulesCli } = await import('./schedules-cli')
      const exitCode = await runSchedulesCli(argv.slice(1))
      await flushCliOutput()
      appLifecycle.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      const kind = writeSessionsCliError(error, argv.includes('--json'))
      await flushCliOutput().catch(() => undefined)
      appLifecycle.exit(sessionCliExitCodeForError(kind))
    })
  return true
}
