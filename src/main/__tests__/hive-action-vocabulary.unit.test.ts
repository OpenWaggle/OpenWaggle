import { describe, expect, it } from 'vitest'
import {
  actionChoices,
  sessionsToolParameterVariants,
} from '../adapters/pi/sessions-tool-flat-schema'
import { OPENWAGGLE_MCP_SESSION_OPERATIONS_V2 } from '../openwaggle-mcp-session-operations-v2'
import { validateSessionsCliOptions } from '../sessions-cli-option-contract'

/**
 * The tool actions without a `hive` subcommand or MCP operation of the same name (ADR 0053,
 * amendment of October 2026): Scheduled tasks keep their own `openwaggle schedules` command,
 * and an MCP server holds no lasting creator for them.
 */
const NOT_ON_THE_HIVE_CLI = [
  'schedule_create',
  'schedule_delete',
  'schedule_list',
  'schedule_read',
  'schedule_run_now',
  'schedule_runs',
  'schedule_update',
] as const
const NOT_ON_MCP = NOT_ON_THE_HIVE_CLI

/** CLI subcommands that are the CLI's own event streams, with no tool action or MCP operation. */
const CLI_ONLY_STREAMS = ['watch', 'exports-watch'] as const

function isHiveSubcommand(subcommand: string) {
  try {
    validateSessionsCliOptions(subcommand, { positionals: [], passthrough: [], options: new Map() })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return !message.startsWith('Unsupported OpenWaggle Hive command')
  }
}

const toolActions = sessionsToolParameterVariants
  .flatMap((variant) => actionChoices(variant.properties.action).map((choice) => choice.const))
  .sort()
const asSubcommand = (action: string) => action.replaceAll('_', '-')
const mcpOperations: ReadonlySet<string> = new Set(OPENWAGGLE_MCP_SESSION_OPERATIONS_V2)

describe('one Hive action vocabulary across the tool, CLI, and MCP (ADR 0053)', () => {
  it('names a hive CLI subcommand for every tool action but the listed exceptions', () => {
    expect(toolActions.length).toBeGreaterThan(50)
    expect(toolActions.filter((action) => !isHiveSubcommand(asSubcommand(action)))).toEqual([
      ...NOT_ON_THE_HIVE_CLI,
    ])
  })

  it('names an MCP operation for every tool action but the listed exceptions', () => {
    expect(toolActions.filter((action) => !mcpOperations.has(asSubcommand(action)))).toEqual([
      ...NOT_ON_MCP,
    ])
  })

  it('has no MCP operation the tool lacks, and each one is the hive subcommand of that name', () => {
    const tool = new Set(toolActions.map(asSubcommand))
    expect([...mcpOperations].filter((operation) => !tool.has(operation))).toEqual([])
    expect([...mcpOperations].filter((operation) => !isHiveSubcommand(operation))).toEqual([])
  })

  it('keeps the CLI-only event streams', () => {
    for (const stream of CLI_ONLY_STREAMS) {
      expect(isHiveSubcommand(stream)).toBe(true)
      expect(mcpOperations.has(stream)).toBe(false)
    }
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
