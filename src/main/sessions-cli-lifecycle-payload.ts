import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_LIFECYCLE_CONTRACT_VERSION } from '@shared/types/session-lifecycle'
import { resolveCliProjectPath } from './cli-project-path'
import { option, type ParsedArguments } from './mcp-cli-arguments'
import {
  forkWorkspace,
  launchWorkspace,
  positiveInteger,
  required,
  runAuthorization,
  spawnWorkspace,
  specialization,
} from './sessions-cli-arguments'

function lifecycleRequest(arguments_: ParsedArguments) {
  return {
    contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
    requestId: randomUUID(),
    idempotencyKey: option(arguments_, 'idempotency-key') ?? randomUUID(),
  }
}

export function rootLifecyclePayload(
  command: 'create' | 'launch',
  arguments_: ParsedArguments,
  workingDirectory = process.cwd(),
): LocalSessionCommandPayload {
  const projectPath = resolveCliProjectPath(
    required(arguments_.positionals[0], 'Project path'),
    workingDirectory,
  )
  const workspace = launchWorkspace(arguments_)
  const selectedSpecialization = specialization(arguments_)
  if (command === 'create') {
    return {
      contract: 'session-lifecycle-v2',
      request: {
        ...lifecycleRequest(arguments_),
        command: {
          operation: command,
          projectPath,
          ...(option(arguments_, 'title') ? { title: option(arguments_, 'title') } : {}),
          ...(workspace ? { workspace } : {}),
          ...(selectedSpecialization ? { specialization: selectedSpecialization } : {}),
        },
      },
    }
  }
  const authorization = runAuthorization(arguments_)
  const interactionTimeoutMs = option(arguments_, 'interaction-timeout-ms')
    ? positiveInteger(option(arguments_, 'interaction-timeout-ms'), '--interaction-timeout-ms')
    : undefined
  return {
    contract: 'session-lifecycle-v2',
    ...(arguments_.options.has('attach')
      ? { transport: { attachmentPaths: arguments_.options.get('attach') ?? [] } }
      : {}),
    request: {
      ...lifecycleRequest(arguments_),
      command: {
        operation: command,
        projectPath,
        objective: required(option(arguments_, 'text'), 'Objective input'),
        attachmentIds: [],
        ...(interactionTimeoutMs !== undefined ? { interactionTimeoutMs } : {}),
        ...(workspace ? { workspace } : {}),
        ...(option(arguments_, 'title') ? { title: option(arguments_, 'title') } : {}),
        ...(selectedSpecialization ? { specialization: selectedSpecialization } : {}),
        ...(authorization ? { runAuthorizationOverride: authorization } : {}),
      },
    },
  }
}

export function spawnLifecyclePayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const workspace = spawnWorkspace(arguments_)
  const selectedSpecialization = specialization(arguments_)
  const authorization = runAuthorization(arguments_)
  const interactionTimeoutMs = option(arguments_, 'interaction-timeout-ms')
    ? positiveInteger(option(arguments_, 'interaction-timeout-ms'), '--interaction-timeout-ms')
    : undefined
  return {
    contract: 'session-lifecycle-v2',
    ...(arguments_.options.has('attach')
      ? { transport: { attachmentPaths: arguments_.options.get('attach') ?? [] } }
      : {}),
    request: {
      ...lifecycleRequest(arguments_),
      command: {
        operation: 'spawn',
        parentSessionId: required(arguments_.positionals[0], 'Parent Session ID'),
        expectedParentRunId: required(option(arguments_, 'expected-run'), '--expected-run'),
        ...(workspace ? { workspace } : {}),
        ...(selectedSpecialization ? { specialization: selectedSpecialization } : {}),
        ...(authorization ? { runAuthorizationOverride: authorization } : {}),
        ...(interactionTimeoutMs !== undefined ? { interactionTimeoutMs } : {}),
        attachmentIds: [],
        delegation: {
          objective: required(option(arguments_, 'text'), 'Objective input'),
          deliverables: arguments_.options.get('deliverable') ?? [],
          acceptanceCriteria: arguments_.options.get('accept') ?? [],
          dependencies: [],
          resourceReferences: arguments_.options.get('resource') ?? [],
        },
      },
    },
  }
}

export function forkLifecyclePayload(arguments_: ParsedArguments): LocalSessionCommandPayload {
  const workspace = forkWorkspace(arguments_)
  const position = option(arguments_, 'position')
  if (position && position !== 'before' && position !== 'at') {
    throw new Error('--position must be before or at.')
  }
  const selectedPosition = position === 'before' || position === 'at' ? position : undefined
  return {
    contract: 'session-lifecycle-v2',
    request: {
      ...lifecycleRequest(arguments_),
      command: {
        operation: 'fork',
        sourceSessionId: required(arguments_.positionals[0], 'Source Session ID'),
        ...(option(arguments_, 'target-node')
          ? { targetNodeId: option(arguments_, 'target-node') }
          : {}),
        ...(selectedPosition ? { position: selectedPosition } : {}),
        ...(option(arguments_, 'title') ? { title: option(arguments_, 'title') } : {}),
        ...(workspace ? { workspace } : {}),
      },
    },
  }
}
