import { validateCommandCliOptions } from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'

const CLIENT_OPTIONS = ['profile', 'credential-stdin', 'profile-credential-file'] as const
const COMMON_OPTIONS = [...CLIENT_OPTIONS, 'json'] as const
const MUTATION_OPTIONS = ['idempotency-key'] as const
const CATALOG_OPTIONS = ['project', 'all', 'parent', 'worker', 'limit', 'cursor'] as const
const OPTIONS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  help: [],
  list: [...CATALOG_OPTIONS, 'state'],
  read: [],
  conflicts: [...CATALOG_OPTIONS, 'delegation', 'kind', 'status'],
  submit: ['evidence-json', ...MUTATION_OPTIONS],
  state: MUTATION_OPTIONS,
  claim: ['claim-json', ...MUTATION_OPTIONS],
  'acknowledge-conflict': MUTATION_OPTIONS,
  dependency: MUTATION_OPTIONS,
  'propose-amendment': ['specification-json', ...MUTATION_OPTIONS],
  amend: ['specification-json', 'proposal', ...MUTATION_OPTIONS],
  verify: ['evidence-json', ...MUTATION_OPTIONS],
  'request-revision': [
    'revised-objective',
    'deliverable',
    'accept',
    'resource',
    ...MUTATION_OPTIONS,
  ],
  accept: MUTATION_OPTIONS,
  reopen: MUTATION_OPTIONS,
  cancel: MUTATION_OPTIONS,
}
const BOOLEAN_OPTIONS = new Set(['all', 'credential-stdin', 'json'])
const ARGUMENTS_BY_COMMAND = {
  help: { minimum: 0, maximum: 0 },
  list: { minimum: 0, maximum: 0 },
  read: { minimum: 1, maximum: 1 },
  conflicts: { minimum: 0, maximum: 0 },
  submit: { minimum: 3 },
  state: { minimum: 4 },
  claim: { minimum: 3 },
  'acknowledge-conflict': { minimum: 4 },
  dependency: { minimum: 6 },
  'propose-amendment': { minimum: 4 },
  amend: { minimum: 4 },
  verify: { minimum: 5 },
  'request-revision': { minimum: 4 },
  accept: { minimum: 3 },
  reopen: { minimum: 3 },
  cancel: { minimum: 3 },
} as const

export function validateDelegationsCliOptions(command: string, arguments_: ParsedArguments) {
  validateCommandCliOptions({
    surface: 'OpenWaggle Delegations',
    route: command,
    arguments: arguments_,
    optionsByRoute: OPTIONS_BY_COMMAND,
    commonOptions: COMMON_OPTIONS,
    booleanOptions: BOOLEAN_OPTIONS,
    argumentsByRoute: ARGUMENTS_BY_COMMAND,
  })
}
