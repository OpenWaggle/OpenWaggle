import { app } from 'electron'
import { asUsageErrorsSync, CLI_EXIT, CliError, cliExitCodeForKind } from './cli-error'
import { writeCliStdout } from './cli-stdout'
import { hasFlag, parseMcpCliArguments } from './mcp-cli-arguments'
import { validateRecoveryCliOptions } from './recovery-cli-option-contract'
import { recoveryCliResultText, writeRecoveryCliError } from './recovery-cli-output'
import { withLegacySessionWriterFence } from './session-host/legacy-session-writer-fence'
import { resolveLocalSessionHostPaths } from './session-host/local-session-paths'
import {
  deletePreCutoverDatabase,
  restorePreCutoverDatabase,
  sessionHostRecoveryStatus,
} from './session-host/session-host-recovery'

const EXIT = CLI_EXIT

function usage() {
  return `OpenWaggle recovery

Usage:
  openwaggle recovery status [--json]
  openwaggle recovery restore-pre-cutover --yes [--json]
  openwaggle recovery delete-pre-cutover --yes [--json]

The Session Host must be stopped for restore and delete. Restore preserves the current active
database as a timestamped artifact before rebuilding from the pre-cutover recovery copy.`
}

function writeResult(command: string, value: unknown, json: boolean) {
  return writeCliStdout(recoveryCliResultText(command, value, json))
}

export async function runRecoveryCli(args: readonly string[]) {
  const json = args.includes('--json')
  try {
    const parsed = parseMcpCliArguments(args)
    const command = parsed.positionals[0]
    const arguments_ = { ...parsed, positionals: parsed.positionals.slice(1) }
    asUsageErrorsSync(() => validateRecoveryCliOptions(command, arguments_))
    if (!command || command === 'help') {
      await writeCliStdout(`${usage()}\n`)
      return EXIT.SUCCESS
    }
    const paths = resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') })
    if (command === 'status') {
      await writeResult(command, await sessionHostRecoveryStatus(paths), json)
      return EXIT.SUCCESS
    }
    if (!hasFlag(arguments_, 'yes')) {
      throw new CliError('usage', 'This operation requires explicit --yes confirmation.')
    }
    const result =
      command === 'restore-pre-cutover'
        ? await withLegacySessionWriterFence(() => restorePreCutoverDatabase(paths))
        : await deletePreCutoverDatabase(paths)
    await writeResult(command, result, json)
    return EXIT.SUCCESS
  } catch (error) {
    return cliExitCodeForKind(writeRecoveryCliError(error, json))
  }
}
