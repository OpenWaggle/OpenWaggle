import { CliError } from './cli-error'
import { CommandCliUsageError } from './command-cli-option-contract'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'
import { positiveInteger } from './sessions-cli-arguments'

/** How long `host stop --wait` waits by default. */
export const HOST_STOP_DEFAULT_TIMEOUT_MS = 120_000

/** `host stop` needs the local user's authority, which an access profile never has. */
export function refuseAccessProfile(profile: string | undefined) {
  if (!profile) return
  throw new CliError(
    'authorization',
    "'host stop' requires the local user's authorization and cannot use an access profile. Unset OPENWAGGLE_PROFILE and try again.",
  )
}

/** How long `--wait` waits, or `undefined` without `--wait`. Checked before the Host is asked. */
export function waitTimeout(parsed: ParsedArguments) {
  if (!hasFlag(parsed, 'wait')) {
    if (parsed.options.has('timeout-ms'))
      throw new CommandCliUsageError('--wait must be given to use --timeout-ms.')
    return undefined
  }
  const timeoutMs = option(parsed, 'timeout-ms')
  return timeoutMs ? positiveInteger(timeoutMs, '--timeout-ms') : HOST_STOP_DEFAULT_TIMEOUT_MS
}
