import type { ParsedArguments } from './mcp-cli-arguments'

/** The pre-rename grouped spellings (`sessions delegation submit`), refused with a pointer. */
const FORMER_GROUPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  delegation: {
    submit: 'delegation-submit',
    state: 'delegation-state',
    claim: 'delegation-claim',
    'acknowledge-conflict': 'delegation-conflict-acknowledge',
    dependency: 'delegation-dependency',
    'propose-amendment': 'delegation-propose-amendment',
    amend: 'delegation-amend',
    'request-revision': 'delegation-request-revision',
    accept: 'delegation-accept',
    reopen: 'delegation-reopen',
    cancel: 'delegation-cancel',
    verify: 'delegation-verify',
  },
  delegations: {
    list: 'delegations-list',
    read: 'delegations-read',
    conflicts: 'delegations-conflicts',
  },
  queue: {
    list: 'queue-list',
    withdraw: 'queue-withdraw',
    reorder: 'queue-reorder',
    pause: 'queue-pause',
    resume: 'queue-resume',
  },
  requests: { list: 'requests-list', respond: 'request-respond' },
  authorization: { set: 'authorization-set', clear: 'authorization-set <session-id> inherit' },
  export: {
    create: 'export-create',
    cancel: 'export-cancel',
    list: 'exports-list',
    read: 'exports-read',
    wait: 'exports-wait',
    watch: 'exports-watch',
  },
}

/**
 * The flat Hive subcommand a former grouped spelling such as `queue withdraw` became. An approval
 * (`requests respond --approve`) is its own subcommand, and clearing an override is setting it to
 * `inherit`.
 */
export function formerGroupReplacement(command: string, arguments_: ParsedArguments) {
  const action = arguments_.positionals[0]
  if (action === undefined) return undefined
  if (command === 'requests' && action === 'respond' && arguments_.options.has('approve')) {
    return 'approval-respond'
  }
  return FORMER_GROUPS[command]?.[action]
}
