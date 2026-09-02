import type { ParsedArguments } from './mcp-cli-arguments'

const CLIENT_OPTION_NAMES = new Set(['profile', 'credential-stdin', 'profile-credential-file'])
const OUTPUT_OPTION_NAMES = new Set(['json', 'jsonl'])

export function validateSessionsCliCombinations(command: string, arguments_: ParsedArguments) {
  validateCatalogScope(arguments_)
  validateCredentialSource(arguments_)
  validateWorkspaceOptions(arguments_)
  validateReadOptions(command, arguments_)
  validateRequestJson(command, arguments_)
}

function validateCatalogScope(arguments_: ParsedArguments) {
  if (arguments_.options.has('all') && arguments_.options.has('project')) {
    throw new Error('Choose either --project or --all, not both.')
  }
}

function validateCredentialSource(arguments_: ParsedArguments) {
  if (
    arguments_.options.has('credential-stdin') &&
    arguments_.options.has('profile-credential-file')
  ) {
    throw new Error('Choose either --credential-stdin or --profile-credential-file, not both.')
  }
  if (
    arguments_.options.has('credential-stdin') &&
    (arguments_.options.has('stdin') || arguments_.options.get('request-json')?.at(-1) === '-')
  ) {
    throw new Error('--credential-stdin cannot share stdin with --stdin or --request-json -.')
  }
}

function validateWorkspaceOptions(arguments_: ParsedArguments) {
  const workspace = arguments_.options.get('workspace')?.at(-1)
  if (arguments_.options.has('workspace-id') && workspace !== 'existing') {
    throw new Error('--workspace-id requires --workspace existing.')
  }
  if (
    (arguments_.options.has('base-ref') || arguments_.options.has('start-from-origin')) &&
    workspace !== 'new-worktree'
  ) {
    throw new Error('--base-ref and --start-from-origin require --workspace new-worktree.')
  }
}

function validateReadOptions(command: string, arguments_: ParsedArguments) {
  if (
    command === 'read' &&
    (arguments_.options.has('scope') || arguments_.options.has('branch')) &&
    !arguments_.options.has('full')
  ) {
    throw new Error('--scope and --branch require sessions read --full.')
  }
}

function validateRequestJson(command: string, arguments_: ParsedArguments) {
  if (!arguments_.options.has('request-json')) return
  const payloadOptions = [...arguments_.options.keys()].filter(
    (name) =>
      name !== 'request-json' && !CLIENT_OPTION_NAMES.has(name) && !OUTPUT_OPTION_NAMES.has(name),
  )
  if (payloadOptions.length > 0) {
    throw new Error(
      `--request-json contains the complete ${command} request and cannot be combined with ${payloadOptions
        .sort()
        .map((name) => `--${name}`)
        .join(', ')}.`,
    )
  }
}
