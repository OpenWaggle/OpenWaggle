import { UPDATE_CHANNELS } from '@shared/types/update-channel'
import {
  isFlagValue,
  isOptionWithoutValue,
  option,
  type ParsedArguments,
} from './mcp-cli-arguments'
import { UpdateCliUsageError } from './update-cli-exact-version'

export function usage() {
  return `OpenWaggle update

Usage:
  openwaggle update [--channel stable|beta|alpha] [--check [--json]]
  openwaggle update --version <version> [--check [--json]]

The selected channel is shared with the desktop app. --check only reports: it never changes the
saved channel, even with --channel. With --json it prints one JSON response that includes the
saved channel. An exact version is a one-time install, does not change the saved channel, and
cannot be older than the installed version: downgrades are unsupported.`
}

export function validateArguments(args: ParsedArguments) {
  if (args.positionals.length > 0 || args.passthrough.length > 0) {
    throw new UpdateCliUsageError('OpenWaggle update received unexpected positional arguments.')
  }
  const known = new Set(['channel', 'version', 'check', 'json', 'help'])
  const unknown = [...args.options.keys()].filter((name) => !known.has(name))
  if (unknown.length > 0) {
    throw new UpdateCliUsageError(`Unknown option for OpenWaggle update: --${unknown[0]}.`)
  }
  for (const name of ['channel', 'version']) {
    const value = option(args, name)
    // An empty value, as in --version="$V" with $V unset, is missing too.
    if (value !== undefined && (value === '' || isOptionWithoutValue(value))) {
      throw new UpdateCliUsageError(`Missing value for --${name}.`)
    }
  }
  for (const name of ['check', 'json', 'help']) {
    const value = option(args, name)
    if (value !== undefined && !isFlagValue(value)) {
      throw new UpdateCliUsageError(`--${name} does not accept values.`)
    }
  }
  if (args.options.has('channel') && args.options.has('version')) {
    throw new UpdateCliUsageError('--channel and --version cannot be used together.')
  }
  // Only a check has one response to print; an install reports its progress as it goes.
  if (args.options.has('json') && !args.options.has('check')) {
    throw new UpdateCliUsageError('--json works only with --check.')
  }
}

export function parseChannel(value: string | undefined) {
  if (value === undefined) return undefined
  const channel = UPDATE_CHANNELS.find((candidate) => candidate === value)
  if (!channel) {
    throw new UpdateCliUsageError(`Unsupported update channel ${JSON.stringify(value)}.`)
  }
  return channel
}
