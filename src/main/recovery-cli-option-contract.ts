import { validateCommandCliOptions, validateImplicitCliHelp } from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'

const COMMON_OPTIONS = ['json'] as const
const OPTIONS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  help: [],
  status: [],
  'restore-pre-cutover': ['yes'],
  'delete-pre-cutover': ['yes'],
}
const BOOLEAN_OPTIONS = new Set(['json', 'yes'])
const ARGUMENTS_BY_COMMAND = {
  help: { minimum: 0, maximum: 0 },
  status: { minimum: 0, maximum: 0 },
  'restore-pre-cutover': { minimum: 0, maximum: 0 },
  'delete-pre-cutover': { minimum: 0, maximum: 0 },
} as const

export function validateRecoveryCliOptions(
  command: string | undefined,
  arguments_: ParsedArguments,
) {
  if (!command) {
    validateImplicitCliHelp('OpenWaggle Recovery', arguments_)
    return
  }
  validateCommandCliOptions({
    surface: 'OpenWaggle Recovery',
    route: command,
    arguments: arguments_,
    optionsByRoute: OPTIONS_BY_COMMAND,
    commonOptions: COMMON_OPTIONS,
    booleanOptions: BOOLEAN_OPTIONS,
    argumentsByRoute: ARGUMENTS_BY_COMMAND,
  })
}
