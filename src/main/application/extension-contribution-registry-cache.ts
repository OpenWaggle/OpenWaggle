import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeScope } from '@shared/types/extension-broker'
import type { DiscoveredExtensionPackage, ExtensionPackageScope } from '../extensions/types'
import {
  type ContributionRegistrationEntry,
  type ContributionRegistrationResult,
  packageContributionRegistrations,
} from './extension-contribution-registration-model'

interface ContributionRegistrationCacheEntry {
  readonly validationKey: string
  readonly result: ContributionRegistrationResult
}

interface RuntimeContributionRegistrationCacheEntry {
  readonly validationKey: string
  readonly registrations: readonly ContributionRegistrationEntry[]
}

interface ContributionRegistrationCacheStats {
  readonly hits: number
  readonly misses: number
  readonly invalidations: number
  readonly size: number
}

const CONTRIBUTION_REGISTRY_CACHE_VERSION = 1

const contributionRegistrationCache = new Map<string, ContributionRegistrationCacheEntry>()
const runtimeContributionRegistrationCache = new Map<
  string,
  RuntimeContributionRegistrationCacheEntry
>()
let contributionRegistrationCacheHits = 0
let contributionRegistrationCacheMisses = 0
let contributionRegistrationCacheInvalidations = 0

function scopeCacheSegment(scope: ExtensionPackageScope) {
  return matchBy(scope, 'kind')
    .with(OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND, () => OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND)
    .with(
      OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND,
      (projectScope) =>
        `${OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND}:${projectScope.projectPath.trim()}`,
    )
    .exhaustive()
}

function packageIdentityCacheKey(extensionPackage: DiscoveredExtensionPackage) {
  return [
    extensionPackage.id,
    scopeCacheSegment(extensionPackage.scope),
    extensionPackage.packagePath,
    extensionPackage.manifestPath,
  ].join(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
}

function packageValidationCacheKey(extensionPackage: DiscoveredExtensionPackage) {
  return [
    `registry:${String(CONTRIBUTION_REGISTRY_CACHE_VERSION)}`,
    `sdk:${OPENWAGGLE_EXTENSION.SDK_VERSION}`,
    `manifest:${String(extensionPackage.manifest?.manifestVersion ?? 'invalid')}`,
    `content:${extensionPackage.contentHash ?? 'none'}`,
  ].join(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
}

function runtimeRegistrationEntry(
  extensionPackage: DiscoveredExtensionPackage,
): RuntimeContributionRegistrationCacheEntry | null {
  const identityKey = packageIdentityCacheKey(extensionPackage)
  const validationKey = packageValidationCacheKey(extensionPackage)
  const cached = runtimeContributionRegistrationCache.get(identityKey)
  if (!cached) {
    return null
  }

  if (cached.validationKey === validationKey) {
    return cached
  }

  runtimeContributionRegistrationCache.delete(identityKey)
  contributionRegistrationCacheInvalidations += 1
  return null
}

function runtimeRegistrations(
  extensionPackage: DiscoveredExtensionPackage,
): readonly ContributionRegistrationEntry[] {
  return runtimeRegistrationEntry(extensionPackage)?.registrations ?? []
}

function uniqueTrimmedValues(values: readonly string[] | undefined) {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of values ?? []) {
    const trimmed = value.trim()
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed)
      normalized.push(trimmed)
    }
  }
  return normalized
}

function normalizedTargetSegment(registration: ContributionRegistrationEntry) {
  return JSON.stringify({
    projectPaths: uniqueTrimmedValues(registration.contribution.target?.projectPaths),
    sessionIds: uniqueTrimmedValues(registration.contribution.target?.sessionIds),
  })
}

function runtimeRegistrationIdentityKey(registration: ContributionRegistrationEntry) {
  return [
    registration.family,
    registration.contribution.id,
    normalizedTargetSegment(registration),
  ].join(OPENWAGGLE_EXTENSION.HASH.FIELD_SEPARATOR)
}

function targetIncludes(values: readonly string[] | undefined, expectedValue: string) {
  return uniqueTrimmedValues(values).includes(expectedValue.trim())
}

function runtimeRegistrationMatchesInvocationScope(input: {
  readonly registration: ContributionRegistrationEntry
  readonly invocationScope: ExtensionInvokeScope
}) {
  return matchBy(input.invocationScope, 'kind')
    .with('app', () => true)
    .with('project', (scope) =>
      targetIncludes(input.registration.contribution.target?.projectPaths, scope.projectPath),
    )
    .with('session', (scope) => {
      const target = input.registration.contribution.target
      return (
        targetIncludes(target?.projectPaths, scope.projectPath) &&
        targetIncludes(target?.sessionIds, scope.sessionId)
      )
    })
    .with('branch', () => false)
    .exhaustive()
}

function mergeRuntimeRegistrations(input: {
  readonly staticResult: ContributionRegistrationResult
  readonly runtime: readonly ContributionRegistrationEntry[]
}): ContributionRegistrationResult {
  if (input.runtime.length === 0) {
    return input.staticResult
  }

  return {
    registrations: [...input.staticResult.registrations, ...input.runtime],
    diagnostics: input.staticResult.diagnostics,
  }
}

export function getCachedPackageContributionRegistrations(
  extensionPackage: DiscoveredExtensionPackage,
): ContributionRegistrationResult {
  const identityKey = packageIdentityCacheKey(extensionPackage)
  const validationKey = packageValidationCacheKey(extensionPackage)
  const cached = contributionRegistrationCache.get(identityKey)

  if (cached?.validationKey === validationKey) {
    contributionRegistrationCacheHits += 1
    return mergeRuntimeRegistrations({
      staticResult: cached.result,
      runtime: runtimeRegistrations(extensionPackage),
    })
  }

  if (cached) {
    contributionRegistrationCacheInvalidations += 1
  }
  contributionRegistrationCacheMisses += 1

  const result = packageContributionRegistrations(extensionPackage)
  contributionRegistrationCache.set(identityKey, { validationKey, result })
  return mergeRuntimeRegistrations({
    staticResult: result,
    runtime: runtimeRegistrations(extensionPackage),
  })
}

export function registerRuntimePackageContribution(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly registration: ContributionRegistrationEntry
}): void {
  const identityKey = packageIdentityCacheKey(input.extensionPackage)
  const validationKey = packageValidationCacheKey(input.extensionPackage)
  const current = runtimeRegistrationEntry(input.extensionPackage)
  const existingRegistrations = current?.registrations ?? []
  const inputRegistrationKey = runtimeRegistrationIdentityKey(input.registration)
  const registrations = existingRegistrations.filter(
    (registration) => runtimeRegistrationIdentityKey(registration) !== inputRegistrationKey,
  )

  runtimeContributionRegistrationCache.set(identityKey, {
    validationKey,
    registrations: [...registrations, input.registration],
  })
}

export function unregisterRuntimePackageContribution(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly family: ContributionRegistrationEntry['family']
  readonly contributionId: string
  readonly invocationScope: ExtensionInvokeScope
}): boolean {
  const identityKey = packageIdentityCacheKey(input.extensionPackage)
  const current = runtimeRegistrationEntry(input.extensionPackage)
  if (!current) {
    return false
  }

  const registrations = current.registrations.filter(
    (registration) =>
      registration.family !== input.family ||
      registration.contribution.id !== input.contributionId ||
      !runtimeRegistrationMatchesInvocationScope({
        registration,
        invocationScope: input.invocationScope,
      }),
  )
  if (registrations.length === current.registrations.length) {
    return false
  }

  if (registrations.length === 0) {
    runtimeContributionRegistrationCache.delete(identityKey)
    return true
  }

  runtimeContributionRegistrationCache.set(identityKey, {
    validationKey: current.validationKey,
    registrations,
  })
  return true
}

export function clearCachedPackageContributionRegistrations(
  extensionPackage: DiscoveredExtensionPackage,
): void {
  try {
    const identityKey = packageIdentityCacheKey(extensionPackage)
    const staticDeleted = contributionRegistrationCache.delete(identityKey)
    const runtimeDeleted = runtimeContributionRegistrationCache.delete(identityKey)
    if (staticDeleted || runtimeDeleted) {
      contributionRegistrationCacheInvalidations += 1
    }
  } catch {
    clearContributionRegistrationCacheOnKeyFailure()
  }
}

export function pruneCachedPackageContributionRegistrations(
  extensionPackages: readonly DiscoveredExtensionPackage[],
): void {
  try {
    const activePackageKeys = new Set(extensionPackages.map(packageIdentityCacheKey))

    for (const cachedKey of contributionRegistrationCache.keys()) {
      if (!activePackageKeys.has(cachedKey)) {
        contributionRegistrationCache.delete(cachedKey)
        contributionRegistrationCacheInvalidations += 1
      }
    }
  } catch {
    clearContributionRegistrationCacheOnKeyFailure()
  }
}

function clearContributionRegistrationCacheOnKeyFailure() {
  if (contributionRegistrationCache.size > 0 || runtimeContributionRegistrationCache.size > 0) {
    contributionRegistrationCache.clear()
    runtimeContributionRegistrationCache.clear()
    contributionRegistrationCacheInvalidations += 1
  }
}

export function clearExtensionContributionRegistryCacheForTests() {
  contributionRegistrationCache.clear()
  runtimeContributionRegistrationCache.clear()
  contributionRegistrationCacheHits = 0
  contributionRegistrationCacheMisses = 0
  contributionRegistrationCacheInvalidations = 0
}

export function getExtensionContributionRegistryCacheStatsForTests(): ContributionRegistrationCacheStats {
  return {
    hits: contributionRegistrationCacheHits,
    misses: contributionRegistrationCacheMisses,
    invalidations: contributionRegistrationCacheInvalidations,
    size: contributionRegistrationCache.size + runtimeContributionRegistrationCache.size,
  }
}
