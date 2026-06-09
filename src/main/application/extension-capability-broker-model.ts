import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailureCode,
  ExtensionInvokeInput,
  ExtensionInvokeScope,
} from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { DiscoveredExtensionPackage } from '../extensions/types'

export function normalizeScope(scope: ExtensionInvokeScope): ExtensionInvokeScope {
  return matchBy(scope, 'kind')
    .with('app', (value) => value)
    .with('project', (value) => ({ ...value, projectPath: value.projectPath.trim() }))
    .with('session', (value) => ({
      ...value,
      projectPath: value.projectPath.trim(),
      sessionId: value.sessionId.trim(),
    }))
    .with('branch', (value) => ({
      ...value,
      projectPath: value.projectPath.trim(),
      sessionId: value.sessionId.trim(),
      branchId: value.branchId.trim(),
    }))
    .exhaustive()
}

export function normalizeInput(input: ExtensionInvokeInput): ExtensionInvokeInput {
  return { ...input, scope: normalizeScope(input.scope) }
}

export function getScopeProjectPath(scope: ExtensionInvokeScope) {
  return scope.kind === 'app' ? undefined : scope.projectPath
}

export function entryMatchesPackage(
  entry: ExtensionContributionRegistryEntry,
  extensionPackage: DiscoveredExtensionPackage,
) {
  if (entry.scope.kind !== extensionPackage.scope.kind) {
    return false
  }

  if (entry.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return true
  }

  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
    entry.scope.projectPath === extensionPackage.scope.projectPath
  )
}

export function pickInvocationPackage(
  candidates: readonly DiscoveredExtensionPackage[],
  projectPath: string | undefined,
) {
  if (projectPath) {
    const projectPackage = candidates.find(
      (candidate) =>
        candidate.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
        candidate.scope.projectPath === projectPath,
    )
    if (projectPackage) {
      return projectPackage
    }
  }

  return (
    candidates.find(
      (candidate) => candidate.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND,
    ) ?? null
  )
}

export function makeCapabilityAudit(input: {
  readonly invocation: ExtensionInvokeInput
  readonly outcome: ExtensionCapabilityAuditEntry['outcome']
  readonly timestamp: number
  readonly failureCode?: ExtensionInvokeFailureCode
}): ExtensionCapabilityAuditEntry {
  return {
    extensionId: input.invocation.extensionId,
    contributionId: input.invocation.contributionId,
    capability: input.invocation.capability,
    method: input.invocation.method,
    scope: input.invocation.scope,
    outcome: input.outcome,
    timestamp: input.timestamp,
    ...(input.failureCode !== undefined ? { failureCode: input.failureCode } : {}),
  }
}

function isPayloadEmptyObject(payload: unknown) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    !Array.isArray(payload) &&
    Object.keys(payload).length === 0
  )
}

export function hostContextPayloadIsValid(payload: unknown) {
  return payload === undefined || isPayloadEmptyObject(payload)
}
