import { validateCommandCliOptions } from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'

const COMMON_OPTIONS = ['json'] as const
const OPTIONS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  help: [],
  list: ['project'],
  search: ['project'],
  validate: [],
  explain: ['project'],
  create: ['scope', 'project'],
  update: ['scope', 'project', 'expected-digest'],
  duplicate: ['scope', 'project'],
  delete: ['scope', 'project', 'expected-digest'],
  import: ['from', 'scope', 'project', 'source-name', 'dry-run', 'replace', 'expected-digest'],
  refresh: ['project', 'dry-run', 'replace'],
}
const BOOLEAN_OPTIONS = new Set(['dry-run', 'json', 'replace'])
const ARGUMENTS_BY_COMMAND = {
  help: { minimum: 0, maximum: 0 },
  list: { minimum: 0, maximum: 0 },
  search: { minimum: 1 },
  validate: { minimum: 1, maximum: 1 },
  explain: { minimum: 1, maximum: 1 },
  create: { minimum: 1, maximum: 1 },
  update: { minimum: 1, maximum: 1 },
  duplicate: { minimum: 2, maximum: 2 },
  delete: { minimum: 1, maximum: 1 },
  import: { minimum: 1, maximum: 1 },
  refresh: { minimum: 1, maximum: 1 },
} as const

export function validateAgentsCliOptions(command: string, arguments_: ParsedArguments) {
  validateCommandCliOptions({
    surface: 'OpenWaggle Agents',
    route: command,
    arguments: arguments_,
    optionsByRoute: OPTIONS_BY_COMMAND,
    commonOptions: COMMON_OPTIONS,
    booleanOptions: BOOLEAN_OPTIONS,
    argumentsByRoute: ARGUMENTS_BY_COMMAND,
  })
}
