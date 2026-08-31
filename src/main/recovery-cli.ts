import { app } from 'electron'
import { isCommandCliUsageError } from './command-cli-option-contract'
import { hasFlag, parseMcpCliArguments } from './mcp-cli-arguments'
import { validateRecoveryCliOptions } from './recovery-cli-option-contract'
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
    process.stdout.write(`${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`)
    return
  }
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

export async function runRecoveryCli(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  const arguments_ = { ...parsed, positionals: parsed.positionals.slice(1) }
  try {
    validateRecoveryCliOptions(command, arguments_)
    if (!command || command === 'help') {
      process.stdout.write(`${usage()}\n`)
      return EXIT.SUCCESS
    }
    const paths = resolveLocalSessionHostPaths({ userDataRoot: app.getPath('userData') })
    if (command === 'status') {
      writeResult(await sessionHostRecoveryStatus(paths), hasFlag(arguments_, 'json'))
      return EXIT.SUCCESS
    }
    if (!hasFlag(arguments_, 'yes')) {
      process.stderr.write('error: This operation requires explicit --yes confirmation.\n')
      return EXIT.USAGE
    }
    const result =
      command === 'restore-pre-cutover'
        ? await withLegacySessionWriterFence(() => restorePreCutoverDatabase(paths))
        : await deletePreCutoverDatabase(paths)
    writeResult(result, hasFlag(arguments_, 'json'))
    return EXIT.SUCCESS
  } catch (error) {
    process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`)
    return isCommandCliUsageError(error) ? EXIT.USAGE : EXIT.FAILURE
  }
}
