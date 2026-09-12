import { validateCommandCliOptions } from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'

const CLIENT_OPTIONS = ['profile', 'credential-stdin', 'profile-credential-file'] as const
const COMMON_OPTIONS = [...CLIENT_OPTIONS, 'idempotency-key', 'json'] as const
const POLICY_OPTIONS = [
  'capability',
  'all',
  'project',
  'export-root',
  'attachment-root',
  'session',
  'hive',
  'authorization',
  'management-envelope-json',
] as const
const DESTINATION_OPTIONS = ['credential-store', 'credential-file', 'replace'] as const
const OPTIONS_BY_OPERATION: Readonly<Record<string, readonly string[]>> = {
  help: [],
  list: [],
  create: [...POLICY_OPTIONS, ...DESTINATION_OPTIONS],
  update: POLICY_OPTIONS,
  rotate: DESTINATION_OPTIONS,
  revoke: [],
}
const BOOLEAN_OPTIONS = new Set(['all', 'credential-stdin', 'credential-store', 'json', 'replace'])
const ARGUMENTS_BY_OPERATION = {
  help: { minimum: 0, maximum: 0 },
  list: { minimum: 0, maximum: 0 },
  create: { minimum: 1, maximum: 1 },
  update: { minimum: 1, maximum: 1 },
  rotate: { minimum: 1, maximum: 1 },
  revoke: { minimum: 1, maximum: 1 },
} as const

export function validateAccessCliOptions(operation: string, arguments_: ParsedArguments) {
  validateCommandCliOptions({
    surface: 'OpenWaggle Access profiles',
    route: operation,
    arguments: arguments_,
    optionsByRoute: OPTIONS_BY_OPERATION,
    commonOptions: COMMON_OPTIONS,
    booleanOptions: BOOLEAN_OPTIONS,
    argumentsByRoute: ARGUMENTS_BY_OPERATION,
  })
}
