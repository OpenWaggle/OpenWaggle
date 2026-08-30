import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type {
  ForkWorkspaceSelection,
  LaunchWorkspaceSelection,
  SessionExecutionSpecialization,
  SpawnWorkspaceSelection,
} from '@shared/types/session-lifecycle'
import type { SessionDiscoveryMode } from '@shared/types/session-query'
import { THINKING_LEVELS } from '@shared/types/settings'
import { hasFlag, option, type ParsedArguments } from './mcp-cli-arguments'

export function required(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required.`)
  return value
}

export function positiveInteger(value: string | undefined, label: string) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return parsed
}

export function nonNegativeInteger(value: string | undefined, label: string) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return parsed
}

export function discoveryMode(value: string | undefined): SessionDiscoveryMode | undefined {
  if (value === undefined) return undefined
  if (value === 'hybrid' || value === 'lexical' || value === 'semantic') return value
  throw new Error('--mode must be one of hybrid, lexical, semantic.')
}

export function runAuthorization(arguments_: ParsedArguments): AgentAuthorizationMode | undefined {
  const explicit = option(arguments_, 'authorization')
  if (hasFlag(arguments_, 'yolo')) {
    if (explicit && explicit !== 'yolo') {
      throw new Error('--yolo cannot be combined with a different --authorization value.')
    }
    return 'yolo'
  }
  if (!explicit || explicit === 'inherit') return undefined
  if (explicit === 'ask-for-approval' || explicit === 'yolo') return explicit
  throw new Error('--authorization must be inherit, ask-for-approval, or yolo.')
}

export function thinkingLevel(value: string | undefined, label = '--thinking') {
  if (!value) return undefined
  const resolved = THINKING_LEVELS.find((candidate) => candidate === value)
  if (!resolved) throw new Error(`${label} must be one of ${THINKING_LEVELS.join(', ')}.`)
  return resolved
}

export function specialization(
  arguments_: ParsedArguments,
): SessionExecutionSpecialization | undefined {
  const modelId = option(arguments_, 'model')
  const resolvedThinkingLevel = thinkingLevel(option(arguments_, 'thinking'))
  const agentDefinitionName = option(arguments_, 'agent')
  return modelId || resolvedThinkingLevel || agentDefinitionName
    ? {
        ...(modelId ? { modelId } : {}),
        ...(resolvedThinkingLevel ? { thinkingLevel: resolvedThinkingLevel } : {}),
        ...(agentDefinitionName ? { agentDefinitionName } : {}),
      }
    : undefined
}

function worktreeSelection(arguments_: ParsedArguments) {
  return {
    mode: 'new-worktree' as const,
    ...(option(arguments_, 'base-ref') ? { baseRef: option(arguments_, 'base-ref') } : {}),
    ...(hasFlag(arguments_, 'start-from-origin') ? { startFromOrigin: true } : {}),
  }
}

export function launchWorkspace(arguments_: ParsedArguments): LaunchWorkspaceSelection | undefined {
  const mode = option(arguments_, 'workspace')
  if (!mode) return undefined
  if (mode === 'current' || mode === 'local') return { mode }
  if (mode === 'existing') {
    return { mode, workspaceId: required(option(arguments_, 'workspace-id'), '--workspace-id') }
  }
  if (mode === 'new-worktree') return worktreeSelection(arguments_)
  throw new Error(`Unsupported launch Workspace mode: ${mode}.`)
}

export function spawnWorkspace(arguments_: ParsedArguments): SpawnWorkspaceSelection | undefined {
  const mode = option(arguments_, 'workspace')
  if (!mode) return undefined
  if (mode === 'share-parent' || mode === 'local') return { mode }
  if (mode === 'new-worktree') return worktreeSelection(arguments_)
  throw new Error(`Unsupported spawn Workspace mode: ${mode}.`)
}

export function forkWorkspace(arguments_: ParsedArguments): ForkWorkspaceSelection | undefined {
  const mode = option(arguments_, 'workspace')
  if (!mode) return undefined
  if (mode === 'share-source' || mode === 'local') return { mode }
  if (mode === 'existing') {
    return { mode, workspaceId: required(option(arguments_, 'workspace-id'), '--workspace-id') }
  }
  if (mode === 'new-worktree') return worktreeSelection(arguments_)
  throw new Error(`Unsupported fork Workspace mode: ${mode}.`)
}

export function watchCursor(arguments_: ParsedArguments) {
  const hostInstanceId = option(arguments_, 'after-host')
  const sequence = option(arguments_, 'after-sequence')
  if (hostInstanceId === undefined && sequence === undefined) return undefined
  return {
    hostInstanceId: required(hostInstanceId, '--after-host'),
    sequence: nonNegativeInteger(required(sequence, '--after-sequence'), '--after-sequence'),
  }
}
