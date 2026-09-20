import { app } from 'electron'
import { writeCliStdout } from './cli-stdout'
import { isCommandCliUsageError } from './command-cli-option-contract'
import { hasFlag, parseMcpCliArguments } from './mcp-cli-arguments'
import { validateRecoveryCliOptions } from './recovery-cli-option-contract'
import { writeRecoveryCliError } from './recovery-cli-output'
import { withLegacySessionWriterFence } from './session-host/legacy-session-writer-fence'
import { resolveLocalSessionHostPaths } from './session-host/local-session-paths'
import {
  deletePreCutoverDatabase,
  restorePreCutoverDatabase,
  sessionHostRecoveryStatus,
} from './session-host/session-host-recovery'

const EXIT = { SUCCESS: 0, FAILURE: 1, USAGE: 2 } as const
const JSON_INDENT_SPACES = 2

function usage() {
  return `OpenWaggle recovery

Usage:
  openwaggle recovery status [--json]
  openwaggle recovery restore-pre-cutover --yes [--json]
  openwaggle recovery delete-pre-cutover --yes [--json]

The Session Host must be stopped for restore and delete. Restore preserves the current active
database as a timestamped artifact before rebuilding from the pre-cutover recovery copy.`
}

function writeResult(value: unknown, json: boolean) {
  if (json) {
    return writeCliStdout(`${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`)
  }
  return writeCliStdout(`${JSON.stringify(value)}\n`)
}

export async function runRecoveryCli(args: readonly string[]) {
  const json = args.includes('--json')
  try {
    const parsed = parseMcpCliArguments(args)
    const command = parsed.positionals[0]
    const arguments_ = { ...parsed, positionals: parsed.positionals.slice(1) }
    validateRecoveryCliOptions(command, arguments_)
    if (!command || command === 'help') {
      await writeCliStdout(`${usage()}\n`)
      return EXIT.SUCCESS
    }
    const paths = resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') })
    if (command === 'status') {
      await writeResult(await sessionHostRecoveryStatus(paths), json)
      return EXIT.SUCCESS
    }
    if (!hasFlag(arguments_, 'yes')) {
      writeRecoveryCliError(new Error('This operation requires explicit --yes confirmation.'), json)
      return EXIT.USAGE
    }
    const result =
      command === 'restore-pre-cutover'
        ? await withLegacySessionWriterFence(() => restorePreCutoverDatabase(paths))
        : await deletePreCutoverDatabase(paths)
    await writeResult(result, json)
    return EXIT.SUCCESS
  } catch (error) {
    writeRecoveryCliError(error, json)
    return isCommandCliUsageError(error) ? EXIT.USAGE : EXIT.FAILURE
  }
}
