import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  LocalSessionProfileManagementEnvelope,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import { sessionIdsFromReferences } from '@shared/utils/session-link'
import { resolveCliProjectPaths } from './cli-project-path'
import { CommandCliUsageError } from './command-cli-option-contract'
import type { ParsedArguments } from './mcp-cli-arguments'
import { hasFlag, option } from './mcp-cli-arguments'

/**
 * The options that set a Profile-management envelope: what a profile holding `access:profiles`
 * may hand to the profiles it creates or updates.
 */
export const MANAGEMENT_ENVELOPE_OPTIONS = [
  'manage-capability',
  'manage-all',
  'manage-project',
  'manage-session',
  'manage-hive',
  'manage-export-root',
  'manage-attachment-root',
  'manage-authorization',
] as const

const MANAGEMENT_TARGET_OPTIONS = [
  'manage-all',
  'manage-project',
  'manage-session',
  'manage-hive',
] as const

export function parseProfileCapabilities(
  values: readonly string[] | undefined,
  label = 'capability',
): readonly SessionCapability[] {
  const requested = values ?? []
  const invalid = requested.filter(
    (value) => !SESSION_CAPABILITIES.some((capability) => capability === value),
  )
  if (invalid.length > 0) throw new CommandCliUsageError(`Unknown ${label}: ${invalid.join(', ')}.`)
  return SESSION_CAPABILITIES.filter((capability) => requested.includes(capability))
}

/**
 * The scope the options with this prefix name: `--project`, or `--manage-project` for an
 * envelope. Paths resolve against the working directory, and `--session` and `--hive` take
 * Session identities or Session links (ADR 0056).
 */
function scopeFromOptions(
  arguments_: ParsedArguments,
  prefix: '' | 'manage-',
  workingDirectory: string,
): LocalSessionProfileScope {
  const values = (name: string) => arguments_.options.get(`${prefix}${name}`)
  const paths = (name: string) => resolveCliProjectPaths(values(name), workingDirectory)
  const projectPaths = paths('project')
  const exportRoots = paths('export-root')
  const attachmentRoots = paths('attachment-root')
  const sessions = values('session')
  const hives = values('hive')
  return {
    ...(hasFlag(arguments_, `${prefix}all`) ? { all: true } : {}),
    ...(projectPaths ? { projectPaths } : {}),
    ...(exportRoots ? { exportRoots } : {}),
    ...(attachmentRoots ? { attachmentRoots } : {}),
    ...(sessions ? { sessionIds: sessionIdsFromReferences(sessions, `--${prefix}session`) } : {}),
    ...(hives ? { hiveRootSessionIds: sessionIdsFromReferences(hives, `--${prefix}hive`) } : {}),
  }
}

export function parseProfileScope(
  arguments_: ParsedArguments,
  workingDirectory = process.cwd(),
): LocalSessionProfileScope {
  const selected = scopeFromOptions(arguments_, '', workingDirectory)
  if (
    !selected.all &&
    !selected.projectPaths?.length &&
    !selected.sessionIds?.length &&
    !selected.hiveRootSessionIds?.length
  ) {
    throw new CommandCliUsageError('At least one explicit profile scope is required.')
  }
  return selected
}

function authorizationMode(arguments_: ParsedArguments, name: string): AgentAuthorizationMode {
  const value = option(arguments_, name) ?? 'ask-for-approval'
  if (!isAgentAuthorizationMode(value)) {
    throw new CommandCliUsageError(`--${name} must be ask-for-approval or yolo.`)
  }
  return value
}

export function parseProfileAuthorization(arguments_: ParsedArguments): AgentAuthorizationMode {
  return authorizationMode(arguments_, 'authorization')
}

/**
 * The Profile-management envelope the `--manage-*` options describe, or none when no such option
 * is given. It needs at least one `--manage-capability`, and `--manage-all` alone or any mix of
 * `--manage-project`, `--manage-session` and `--manage-hive`, like the ordinary scope options.
 */
export function parseManagementEnvelope(
  arguments_: ParsedArguments,
  workingDirectory = process.cwd(),
): LocalSessionProfileManagementEnvelope | undefined {
  if (!MANAGEMENT_ENVELOPE_OPTIONS.some((name) => arguments_.options.has(name))) return undefined
  const capabilities = parseProfileCapabilities(
    arguments_.options.get('manage-capability'),
    '--manage-capability',
  )
  if (capabilities.length === 0) {
    throw new CommandCliUsageError(
      'A Profile-management envelope needs at least one --manage-capability.',
    )
  }
  const targets = MANAGEMENT_TARGET_OPTIONS.filter((name) => arguments_.options.has(name))
  if (targets.length === 0) {
    throw new CommandCliUsageError(
      'A Profile-management envelope needs --manage-all, or one or more of --manage-project, --manage-session and --manage-hive.',
    )
  }
  if (targets.includes('manage-all') && targets.length > 1) {
    throw new CommandCliUsageError(
      '--manage-all already covers every target; leave out --manage-project, --manage-session and --manage-hive.',
    )
  }
  return {
    capabilities,
    scope: scopeFromOptions(arguments_, 'manage-', workingDirectory),
    authorizationCeiling: authorizationMode(arguments_, 'manage-authorization'),
  }
}

export function parseProfilePolicy(arguments_: ParsedArguments, workingDirectory = process.cwd()) {
  const capabilities = parseProfileCapabilities(arguments_.options.get('capability'))
  const managing = MANAGEMENT_ENVELOPE_OPTIONS.some((name) => arguments_.options.has(name))
  if (managing && !capabilities.includes('access:profiles')) {
    throw new CommandCliUsageError(
      'The --manage-* options apply only to a profile with --capability access:profiles.',
    )
  }
  const managementEnvelope = parseManagementEnvelope(arguments_, workingDirectory)
  return {
    capabilities,
    scope: parseProfileScope(arguments_, workingDirectory),
    authorizationCeiling: parseProfileAuthorization(arguments_),
    ...(managementEnvelope ? { managementEnvelope } : {}),
  }
}
