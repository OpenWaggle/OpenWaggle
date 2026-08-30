import { randomUUID } from 'node:crypto'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_LIFECYCLE_CONTRACT_VERSION,
  type SessionExecutionSpecialization,
} from '@shared/types/session-lifecycle'
import { THINKING_LEVELS } from '@shared/types/settings'
import type { SessionsToolParameters } from './sessions-tool-parameters'
import type { SessionsToolSource } from './sessions-tool-payload'

type LifecycleParameters = Extract<
  SessionsToolParameters,
  { action: 'create' | 'fork' | 'launch' | 'spawn' }
>

type SpecializableLifecycleParameters = Exclude<LifecycleParameters, { action: 'fork' }>

function thinkingLevel(value: string | undefined) {
  if (!value) return undefined
  const resolved = THINKING_LEVELS.find((candidate) => candidate === value)
  if (!resolved) throw new Error(`Unsupported thinking level: ${value}.`)
  return resolved
}

function specialization(
  input: SpecializableLifecycleParameters,
): SessionExecutionSpecialization | undefined {
  const thinking = thinkingLevel(input.thinking)
  return input.agent || input.model || thinking
    ? {
        ...(input.agent ? { agentDefinitionName: input.agent } : {}),
        ...(input.model ? { modelId: input.model } : {}),
        ...(thinking ? { thinkingLevel: thinking } : {}),
      }
    : undefined
}

function rootWorkspace(input: Extract<LifecycleParameters, { action: 'create' | 'launch' }>) {
  if (!input.workspace) return undefined
  if (input.workspace === 'existing') {
    if (!input.workspaceId)
      throw new Error('sessions root Workspace existing requires workspaceId.')
    return { mode: 'existing' as const, workspaceId: input.workspaceId }
  }
  if (input.workspace === 'new-worktree') {
    return {
      mode: input.workspace,
      ...(input.baseRef ? { baseRef: input.baseRef } : {}),
      ...(input.startFromOrigin === undefined ? {} : { startFromOrigin: input.startFromOrigin }),
    }
  }
  return { mode: input.workspace }
}

function rootPayload(
  input: Extract<LifecycleParameters, { action: 'create' | 'launch' }>,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  const selectedWorkspace = rootWorkspace(input)
  const selectedSpecialization = specialization(input)
  const projectPath =
    input.projectPath ?? source.projectPath ?? source.workingDirectory ?? process.cwd()
  const command =
    input.action === 'create'
      ? {
          operation: input.action,
          projectPath,
          ...(input.title ? { title: input.title } : {}),
          ...(selectedWorkspace ? { workspace: selectedWorkspace } : {}),
          ...(selectedSpecialization ? { specialization: selectedSpecialization } : {}),
        }
      : {
          operation: input.action,
          projectPath,
          objective: input.objective,
          attachmentIds: [],
          ...(input.interactionTimeoutMs !== undefined
            ? { interactionTimeoutMs: input.interactionTimeoutMs }
            : {}),
          ...(input.title ? { title: input.title } : {}),
          ...(selectedWorkspace ? { workspace: selectedWorkspace } : {}),
          ...(selectedSpecialization ? { specialization: selectedSpecialization } : {}),
          ...(input.authorization ? { runAuthorizationOverride: input.authorization } : {}),
        }
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command,
    },
  }
}

function workerPayload(
  input: Extract<LifecycleParameters, { action: 'spawn' }>,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  if (
    (input.baseRef !== undefined || input.startFromOrigin !== undefined) &&
    input.workspace !== 'new-worktree'
  ) {
    throw new Error('sessions spawn baseRef and startFromOrigin require Workspace new-worktree.')
  }
  const selectedSpecialization = specialization(input)
  const workspace =
    input.workspace === 'new-worktree'
      ? {
          mode: input.workspace,
          ...(input.baseRef ? { baseRef: input.baseRef } : {}),
          ...(input.startFromOrigin === undefined
            ? {}
            : { startFromOrigin: input.startFromOrigin }),
        }
      : input.workspace === 'local'
        ? { mode: input.workspace }
        : { mode: 'share-parent' as const }
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command: {
        operation: 'spawn',
        parentSessionId: source.sessionId,
        expectedParentRunId: source.runId,
        ...(input.workspace ? { workspace } : {}),
        ...(selectedSpecialization ? { specialization: selectedSpecialization } : {}),
        ...(input.interactionTimeoutMs !== undefined
          ? { interactionTimeoutMs: input.interactionTimeoutMs }
          : {}),
        ...(input.authorization ? { runAuthorizationOverride: input.authorization } : {}),
        delegation: {
          objective: input.objective,
          deliverables: input.deliverables ?? [],
          acceptanceCriteria: input.acceptanceCriteria ?? [],
          dependencies: [],
          resourceReferences: input.resourceReferences ?? [],
        },
      },
    },
  }
}

function forkPayload(
  input: Extract<LifecycleParameters, { action: 'fork' }>,
  source: SessionsToolSource,
): LocalSessionCommandPayload {
  const workspace =
    input.workspace === 'existing'
      ? {
          mode: input.workspace,
          workspaceId:
            input.workspaceId ??
            (() => {
              throw new Error('sessions fork Workspace existing requires workspaceId.')
            })(),
        }
      : input.workspace === 'new-worktree'
        ? {
            mode: input.workspace,
            ...(input.baseRef ? { baseRef: input.baseRef } : {}),
            ...(input.startFromOrigin === undefined
              ? {}
              : { startFromOrigin: input.startFromOrigin }),
          }
        : input.workspace
          ? { mode: input.workspace }
          : undefined
  return {
    contract: 'session-lifecycle-v2',
    request: {
      contractVersion: SESSION_LIFECYCLE_CONTRACT_VERSION,
      requestId: randomUUID(),
      idempotencyKey: randomUUID(),
      command: {
        operation: 'fork',
        sourceSessionId: input.sessionId ?? source.sessionId,
        ...(input.targetNodeId ? { targetNodeId: input.targetNodeId } : {}),
        ...(input.position ? { position: input.position } : {}),
        ...(input.title ? { title: input.title } : {}),
        ...(workspace ? { workspace } : {}),
      },
    },
  }
}

export function isSessionsToolLifecycleAction(
  input: SessionsToolParameters,
): input is LifecycleParameters {
  return (
    input.action === 'create' ||
    input.action === 'fork' ||
    input.action === 'launch' ||
    input.action === 'spawn'
  )
}

export function buildSessionsToolLifecyclePayload(
  input: LifecycleParameters,
  source: SessionsToolSource,
) {
  if (input.action === 'spawn') return workerPayload(input, source)
  if (input.action === 'fork') return forkPayload(input, source)
  return rootPayload(input, source)
}
