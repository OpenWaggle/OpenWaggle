import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionCapabilityDeclaration } from '@shared/schemas/extensions'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailureCode,
  ExtensionInvokeInput,
  ExtensionInvokeScope,
} from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import type { DiscoveredExtensionPackage } from '../extensions/types'

const DEFAULT_DECLARED_SCOPES = ['app'] as const

export function normalizeScope(scope: ExtensionInvokeScope): ExtensionInvokeScope {
  if (scope.kind === 'app') {
    return scope
  }

  if (scope.kind === 'project') {
    return { ...scope, projectPath: scope.projectPath.trim() }
  }

  if (scope.kind === 'session') {
    return {
      ...scope,
      projectPath: scope.projectPath.trim(),
      sessionId: scope.sessionId.trim(),
    }
  }

  return {
    ...scope,
    projectPath: scope.projectPath.trim(),
    sessionId: scope.sessionId.trim(),
    branchId: scope.branchId.trim(),
  }
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

export function getCapabilityDeclaration(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly capability: string
}) {
  return (
    input.extensionPackage.manifest?.capabilities?.find(
      (capability) => capability.id === input.capability,
    ) ?? null
  )
}

export function getDeclaredScopes(
  declaration: ExtensionCapabilityDeclaration,
): readonly (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number][] {
  return declaration.scopes ?? DEFAULT_DECLARED_SCOPES
}

export function methodIsDeclared(declaration: ExtensionCapabilityDeclaration, method: string) {
  return declaration.methods?.includes(method) === true
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
