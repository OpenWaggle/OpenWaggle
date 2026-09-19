import { decodeLocalSessionProfileManagementEnvelope } from '@shared/schemas/local-session-profile'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  LocalSessionProfileManagementEnvelope,
  LocalSessionProfileScope,
} from '@shared/types/local-session-profile'
import { SESSION_CAPABILITIES, type SessionCapability } from '@shared/types/session-capability'
import { resolveCliProjectPaths } from './cli-project-path'
import type { ParsedArguments } from './mcp-cli-arguments'
import { hasFlag, option } from './mcp-cli-arguments'

export function parseProfileCapabilities(
  values: readonly string[] | undefined,
): readonly SessionCapability[] {
  const requested = values ?? []
  const invalid = requested.filter(
    (value) => !SESSION_CAPABILITIES.some((capability) => capability === value),
  )
  if (invalid.length > 0) throw new Error(`Unknown capability: ${invalid.join(', ')}.`)
  return SESSION_CAPABILITIES.filter((capability) => requested.includes(capability))
}

export function parseProfileScope(
  arguments_: ParsedArguments,
  workingDirectory = process.cwd(),
): LocalSessionProfileScope {
  const selected = {
    ...(hasFlag(arguments_, 'all') ? { all: true } : {}),
    ...(arguments_.options.get('project')
      ? {
          projectPaths: resolveCliProjectPaths(arguments_.options.get('project'), workingDirectory),
        }
      : {}),
    ...(arguments_.options.get('export-root')
      ? {
          exportRoots: resolveCliProjectPaths(
            arguments_.options.get('export-root'),
            workingDirectory,
          ),
        }
      : {}),
    ...(arguments_.options.get('attachment-root')
      ? {
          attachmentRoots: resolveCliProjectPaths(
            arguments_.options.get('attachment-root'),
            workingDirectory,
          ),
        }
      : {}),
    ...(arguments_.options.get('session') ? { sessionIds: arguments_.options.get('session') } : {}),
    ...(arguments_.options.get('hive')
      ? { hiveRootSessionIds: arguments_.options.get('hive') }
      : {}),
  }
  if (
    !selected.all &&
    !selected.projectPaths?.length &&
    !selected.sessionIds?.length &&
    !selected.hiveRootSessionIds?.length
  ) {
    throw new Error('At least one explicit profile scope is required.')
  }
  return selected
}

export function parseProfileAuthorization(arguments_: ParsedArguments): AgentAuthorizationMode {
  const value = option(arguments_, 'authorization') ?? 'ask-for-approval'
  if (!isAgentAuthorizationMode(value)) {
    throw new Error('--authorization must be ask-for-approval or yolo.')
  }
  return value
}

function managementScope(
  value: LocalSessionProfileScope,
  workingDirectory: string,
): LocalSessionProfileScope {
  return {
    ...(value.all === undefined ? {} : { all: value.all }),
    ...(value.projectPaths
      ? { projectPaths: resolveCliProjectPaths(value.projectPaths, workingDirectory) }
      : {}),
    ...(value.exportRoots
      ? { exportRoots: resolveCliProjectPaths(value.exportRoots, workingDirectory) }
      : {}),
    ...(value.attachmentRoots
      ? { attachmentRoots: resolveCliProjectPaths(value.attachmentRoots, workingDirectory) }
      : {}),
    ...(value.sessionIds ? { sessionIds: value.sessionIds } : {}),
    ...(value.hiveRootSessionIds ? { hiveRootSessionIds: value.hiveRootSessionIds } : {}),
  }
}

export function parseManagementEnvelope(
  arguments_: ParsedArguments,
  workingDirectory = process.cwd(),
): LocalSessionProfileManagementEnvelope | undefined {
  const value = option(arguments_, 'management-envelope-json')
  if (!value) return undefined
  const parsed = decodeLocalSessionProfileManagementEnvelope(JSON.parse(value))
  return {
    capabilities: parsed.capabilities,
    scope: managementScope(parsed.scope, workingDirectory),
    authorizationCeiling: parsed.authorizationCeiling,
  }
}

export function parseProfilePolicy(arguments_: ParsedArguments, workingDirectory = process.cwd()) {
  const managementEnvelope = parseManagementEnvelope(arguments_, workingDirectory)
  return {
    capabilities: parseProfileCapabilities(arguments_.options.get('capability')),
    scope: parseProfileScope(arguments_, workingDirectory),
    authorizationCeiling: parseProfileAuthorization(arguments_),
    ...(managementEnvelope ? { managementEnvelope } : {}),
  }
}
