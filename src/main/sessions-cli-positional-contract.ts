import { LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT } from '@shared/types/local-session-protocol'
import {
  type CommandCliArgumentContract,
  validateCommandCliArguments,
} from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'

const DIRECT: Readonly<Record<string, CommandCliArgumentContract>> = {
  help: { minimum: 0, maximum: 0 },
  create: { minimum: 1, maximum: 1 },
  launch: { minimum: 1, maximum: 1 },
  fork: { minimum: 1, maximum: 1 },
  spawn: { minimum: 1, maximum: 1 },
  message: { minimum: 1, maximum: 1 },
  start: { minimum: 1, maximum: 1 },
  'follow-up': { minimum: 1, maximum: 1 },
  steer: { minimum: 1, maximum: 1 },
  replace: { minimum: 1, maximum: 1 },
  interrupt: { minimum: 1, maximum: 1 },
  'interrupt-descendants': { minimum: 1, maximum: 1 },
  rename: { minimum: 2 },
  archive: { minimum: 1, maximum: 1 },
  unarchive: { minimum: 1, maximum: 1 },
  handoff: { minimum: 1, maximum: 1 },
  promote: { minimum: 2, maximum: 2 },
  report: { minimum: 1, maximum: 1 },
  list: { minimum: 0, maximum: 0 },
  search: { minimum: 1 },
  read: { minimum: 1, maximum: 1 },
  turns: { minimum: 1, maximum: 1 },
  items: { minimum: 1, maximum: 1 },
  status: { minimum: 1, maximum: 1 },
  watch: { minimum: 0, maximum: LOCAL_SESSION_SUBSCRIPTION_SESSION_LIMIT },
  wait: { minimum: 1 },
}

const ACTIONS: Readonly<Record<string, CommandCliArgumentContract>> = {
  'authorization-set': { minimum: 2, maximum: 2 },
  'queue-list': { minimum: 1, maximum: 1 },
  'queue-withdraw': { minimum: 2 },
  'queue-reorder': { minimum: 2 },
  'queue-pause': { minimum: 1, maximum: 1 },
  'queue-resume': { minimum: 1, maximum: 1 },
  'requests-list': { minimum: 1, maximum: 1 },
  'request-respond': { minimum: 3, maximum: 3 },
  'approval-respond': { minimum: 3, maximum: 3 },
  'delegation-submit': { minimum: 3 },
  'delegation-state': { minimum: 4 },
  'delegation-claim': { minimum: 3 },
  'delegation-conflict-acknowledge': { minimum: 4 },
  'delegation-dependency': { minimum: 6 },
  'delegation-propose-amendment': { minimum: 4 },
  'delegation-amend': { minimum: 4 },
  'delegation-request-revision': { minimum: 4 },
  'delegation-accept': { minimum: 3 },
  'delegation-reopen': { minimum: 3 },
  'delegation-cancel': { minimum: 3 },
  'delegation-verify': { minimum: 5 },
  'delegations-list': { minimum: 0, maximum: 0 },
  'delegations-read': { minimum: 1, maximum: 1 },
  'delegations-conflicts': { minimum: 0, maximum: 0 },
  export: { minimum: 1, maximum: 1 },
  'export-create': { minimum: 2, maximum: 2 },
  'export-cancel': { minimum: 2, maximum: 2 },
  'exports-list': { minimum: 1, maximum: 1 },
  'exports-read': { minimum: 2, maximum: 2 },
  'exports-wait': { minimum: 2, maximum: 2 },
  'exports-watch': { minimum: 1, maximum: 2 },
  'agent-definitions-list': { minimum: 0, maximum: 0 },
  'agent-definitions-search': { minimum: 1 },
}

export function validateSessionsCliPositionals(command: string, arguments_: ParsedArguments) {
  const contract = DIRECT[command] ?? ACTIONS[command]
  if (!contract) throw new Error(`Unsupported OpenWaggle Hive command: ${command}.`)
  validateCommandCliArguments('OpenWaggle Hive', command, arguments_, contract)
}
