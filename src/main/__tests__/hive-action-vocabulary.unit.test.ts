import { describe, expect, it } from 'vitest'
import {
  actionChoices,
  sessionsToolParameterVariants,
} from '../adapters/pi/sessions-tool-flat-schema'
import { OPENWAGGLE_MCP_SESSION_OPERATIONS_V2 } from '../openwaggle-mcp-session-operations-v2'
import { validateSessionsCliOptions } from '../sessions-cli-option-contract'

/** Scheduled tasks keep their own `openwaggle schedules` command. */
const SCHEDULE_ACTION_PREFIX = 'schedule_'

function hiveSubcommandError(subcommand: string) {
  try {
    validateSessionsCliOptions(subcommand, { positionals: [], passthrough: [], options: new Map() })
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

function isHiveSubcommand(subcommand: string) {
  return !hiveSubcommandError(subcommand)?.startsWith('Unsupported OpenWaggle Hive command')
}

const toolActions = sessionsToolParameterVariants.flatMap((variant) =>
  actionChoices(variant.properties.action).map((choice) => choice.const),
)

describe('one Hive action vocabulary across the tool, CLI, and MCP (ADR 0053)', () => {
  it('names a hive CLI subcommand for every tool action, with - for _', () => {
    const coordination = toolActions.filter((action) => !action.startsWith(SCHEDULE_ACTION_PREFIX))
    expect(coordination.length).toBeGreaterThan(40)
    expect(
      coordination
        .map((action) => action.replaceAll('_', '-'))
        .filter((name) => !isHiveSubcommand(name)),
    ).toEqual([])
  })

  it('names every MCP operation for the hive CLI subcommand of the same name', () => {
    expect(
      OPENWAGGLE_MCP_SESSION_OPERATIONS_V2.filter((operation) => !isHiveSubcommand(operation)),
    ).toEqual([])
  })

  it.each([
    'delegation',
    'delegations',
    'queue',
    'requests',
    'authorization',
    'sessions',
    'agents',
  ])('has no grouped or former subcommand %s', (word) => {
    expect(isHiveSubcommand(word)).toBe(false)
  })
})
