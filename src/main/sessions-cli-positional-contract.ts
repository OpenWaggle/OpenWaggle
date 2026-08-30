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
  watch: { minimum: 0 },
  wait: { minimum: 1 },
}

const GROUPED: Readonly<Record<string, CommandCliArgumentContract>> = {
  'authorization:set': { minimum: 3, maximum: 3 },
  'authorization:clear': { minimum: 2, maximum: 2 },
  'queue:list': { minimum: 2, maximum: 2 },
  'queue:withdraw': { minimum: 3 },
  'queue:reorder': { minimum: 3 },
  'queue:pause': { minimum: 2, maximum: 2 },
  'queue:resume': { minimum: 2, maximum: 2 },
  'queue:update-authorization': { minimum: 3, maximum: 3 },
  'requests:list': { minimum: 2, maximum: 2 },
  'requests:respond': { minimum: 4, maximum: 4 },
  'delegation:submit': { minimum: 4 },
  'delegation:state': { minimum: 5 },
  'delegation:claim': { minimum: 4 },
  'delegation:acknowledge-conflict': { minimum: 5 },
  'delegation:dependency': { minimum: 7 },
  'delegation:propose-amendment': { minimum: 5 },
  'delegation:amend': { minimum: 5 },
  'delegation:request-revision': { minimum: 5 },
  'delegation:accept': { minimum: 4 },
  'delegation:reopen': { minimum: 4 },
  'delegation:cancel': { minimum: 4 },
  'delegation:verify': { minimum: 6 },
  'export:stream': { minimum: 1, maximum: 1 },
  'export:create': { minimum: 3, maximum: 3 },
  'export:cancel': { minimum: 3, maximum: 3 },
  'export:list': { minimum: 2, maximum: 2 },
  'export:read': { minimum: 3, maximum: 3 },
  'export:wait': { minimum: 3, maximum: 3 },
  'export:watch': { minimum: 2, maximum: 3 },
}

export function validateSessionsCliPositionals(route: string, arguments_: ParsedArguments) {
  const contract = DIRECT[route] ?? GROUPED[route]
  if (!contract) throw new Error(`Unsupported Sessions command: ${route}.`)
  validateCommandCliArguments('OpenWaggle Sessions', route.replace(':', ' '), arguments_, contract)
}
