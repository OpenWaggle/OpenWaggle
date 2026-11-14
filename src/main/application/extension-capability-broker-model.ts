import { matchBy } from '@diegogbrisa/ts-match'
import * as Either from 'effect/Either'
import * as Option from 'effect/Option'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailureCode,
  ExtensionInvokeInput,
  ExtensionInvokeScope,
} from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { withoutUndefinedProperties } from '@shared/utils/undefined-properties'
import type { DiscoveredExtensionPackage } from '../extensions/types'
import { contributionMethodIsDeclared } from './extension-contribution-authorization-model'

export function normalizeScope(scope: ExtensionInvokeScope) {
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

/**
 * The invocation with its scope trimmed and its payload without explicit-undefined keys: an
 * extension that builds `{ cursor: undefined }` over postMessage or IPC means no cursor, and the
 * exact optional payload schemas would refuse the key. A payload that contains itself gives
 * `Left` with the invocation without its payload, which the broker refuses as an invalid payload.
 */
export function normalizeInput(input: ExtensionInvokeInput) {
  const { payload: rawPayload, ...rest } = input
  const invocation = { ...rest, scope: normalizeScope(input.scope) } satisfies ExtensionInvokeInput
  const payload = withoutUndefinedProperties(rawPayload)
  if (Option.isNone(payload)) return Either.left(invocation)
  return Either.right({
    ...invocation,
    ...(payload.value === undefined ? {} : { payload: payload.value }),
  } satisfies ExtensionInvokeInput)
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
    return (
      entry.contentHash === extensionPackage.contentHash &&
      entry.packagePath === extensionPackage.packagePath &&
      entry.manifestPath === extensionPackage.manifestPath
    )
  }

  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
    entry.scope.projectPath === extensionPackage.scope.projectPath &&
    entry.contentHash === extensionPackage.contentHash &&
    entry.packagePath === extensionPackage.packagePath &&
    entry.manifestPath === extensionPackage.manifestPath
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
}) {
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

export function contributionEntryDeclaresCapability(input: {
  readonly entry: ExtensionContributionRegistryEntry | null
  readonly invocation: ExtensionInvokeInput
}) {
  return input.entry === null || input.entry.capability === input.invocation.capability
}

export function contributionEntryDeclaresMethod(input: {
  readonly entry: ExtensionContributionRegistryEntry | null
  readonly invocation: ExtensionInvokeInput
}) {
  return input.entry === null || contributionMethodIsDeclared(input.entry, input.invocation.method)
}

export function contributionEntryIsOutOfScope(input: {
  readonly entry: ExtensionContributionRegistryEntry | null
  readonly scopeProjectPath: string | undefined
}) {
  return (
    input.scopeProjectPath !== undefined &&
    input.entry !== null &&
    !input.entry.projectPaths.includes(input.scopeProjectPath)
  )
}
