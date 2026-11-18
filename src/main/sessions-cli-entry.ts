import { HIVE_CLI_COMMAND } from '@shared/constants/hive'
import { flushCliOutput } from './cli-output-flush'
import { appLifecycle } from './desktop-shell/app-lifecycle'
import { env } from './env'
import { sessionCliExitCodeForError } from './session-cli-exit-status'
import { configureAppStoragePaths } from './session-data'
import { writeSessionsCliError } from './sessions-cli-output'

/** `openwaggle hive <subcommand>`; the former `sessions` and `delegations` groups are gone (ADR 0053). */
export function startHiveCliIfRequested(argv: readonly string[]) {
  if (argv[0] !== HIVE_CLI_COMMAND) return false
  configureAppStoragePaths(env.OPENWAGGLE_USER_DATA_DIR)
  void appLifecycle
    .whenReady()
    .then(async () => {
      const { runSessionsCli } = await import('./sessions-cli')
      const exitCode = await runSessionsCli(argv.slice(1))
      await flushCliOutput()
      appLifecycle.exit(exitCode)
    })
    .catch(async (error: unknown) => {
      const kind = writeSessionsCliError(error, argv.includes('--json') || argv.includes('--jsonl'))
      await flushCliOutput().catch(() => undefined)
      appLifecycle.exit(sessionCliExitCodeForError(kind))
    })
  return true
}
