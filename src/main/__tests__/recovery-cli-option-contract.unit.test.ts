import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { validateRecoveryCliOptions } from '../recovery-cli-option-contract'

function invocation(values: readonly string[]) {
  const parsed = parseMcpCliArguments(values)
  return {
    command: parsed.positionals[0],
    arguments: { ...parsed, positionals: parsed.positionals.slice(1) },
  }
}

function validate(values: readonly string[]) {
  const parsed = invocation(values)
  return () => validateRecoveryCliOptions(parsed.command, parsed.arguments)
}

describe('Recovery CLI option contract', () => {
  it('rejects unknown flags on destructive commands instead of ignoring their meaning', () => {
    expect(validate(['delete-pre-cutover', '--yes', '--dry-run'])).toThrow(
      'Unknown option for OpenWaggle Recovery: --dry-run',
    )
  })

  it('rejects inapplicable confirmation, extra positionals, and passthrough input', () => {
    expect(validate(['status', '--yes'])).toThrow(
      'Unsupported option for OpenWaggle Recovery status: --yes',
    )
    expect(validate(['restore-pre-cutover', 'unexpected', '--yes'])).toThrow(
      'received unexpected positional arguments',
    )
    expect(validate(['delete-pre-cutover', '--yes', '--', 'unexpected'])).toThrow(
      'does not accept arguments after --',
    )
  })

  it('rejects valued booleans and option-only invocations', () => {
    expect(validate(['delete-pre-cutover', '--yes=false'])).toThrow('--yes do not accept values')
    expect(validate(['--yes'])).toThrow(
      'Unsupported option-only invocation for OpenWaggle Recovery',
    )
  })

  it('accepts only the documented recovery shapes', () => {
    expect(validate(['status', '--json'])).not.toThrow()
    expect(validate(['restore-pre-cutover', '--yes', '--json'])).not.toThrow()
    expect(validate(['delete-pre-cutover', '--yes'])).not.toThrow()
  })
})
