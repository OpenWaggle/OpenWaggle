import { matchBy } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { DiscoveredExtensionPackage, ExtensionPackageScope } from '../extensions/types'
import {
  type ContributionRegistrationResult,
  packageContributionRegistrations,
} from './extension-contribution-registration-model'

interface ContributionRegistrationCacheEntry {
  readonly validationKey: string
  readonly result: ContributionRegistrationResult
}

interface ContributionRegistrationCacheStats {
  readonly hits: number
  readonly misses: number
  readonly invalidations: number
  readonly size: number
}

const CONTRIBUTION_REGISTRY_CACHE_VERSION = 1

const contributionRegistrationCache = new Map<string, ContributionRegistrationCacheEntry>()
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

export function getCachedPackageContributionRegistrations(
  extensionPackage: DiscoveredExtensionPackage,
): ContributionRegistrationResult {
  const identityKey = packageIdentityCacheKey(extensionPackage)
  const validationKey = packageValidationCacheKey(extensionPackage)
  const cached = contributionRegistrationCache.get(identityKey)

  if (cached?.validationKey === validationKey) {
    contributionRegistrationCacheHits += 1
    return cached.result
  }

  if (cached) {
    contributionRegistrationCacheInvalidations += 1
  }
  contributionRegistrationCacheMisses += 1

  const result = packageContributionRegistrations(extensionPackage)
  contributionRegistrationCache.set(identityKey, { validationKey, result })
  return result
}

export function clearCachedPackageContributionRegistrations(
  extensionPackage: DiscoveredExtensionPackage,
): void {
  if (contributionRegistrationCache.delete(packageIdentityCacheKey(extensionPackage))) {
    contributionRegistrationCacheInvalidations += 1
  }
}

export function pruneCachedPackageContributionRegistrations(
  extensionPackages: readonly DiscoveredExtensionPackage[],
): void {
  const activePackageKeys = new Set(extensionPackages.map(packageIdentityCacheKey))

  for (const cachedKey of contributionRegistrationCache.keys()) {
    if (!activePackageKeys.has(cachedKey)) {
      contributionRegistrationCache.delete(cachedKey)
      contributionRegistrationCacheInvalidations += 1
    }
  }
}

export function clearExtensionContributionRegistryCacheForTests() {
  contributionRegistrationCache.clear()
  contributionRegistrationCacheHits = 0
  contributionRegistrationCacheMisses = 0
  contributionRegistrationCacheInvalidations = 0
}

export function getExtensionContributionRegistryCacheStatsForTests(): ContributionRegistrationCacheStats {
  return {
    hits: contributionRegistrationCacheHits,
    misses: contributionRegistrationCacheMisses,
    invalidations: contributionRegistrationCacheInvalidations,
    size: contributionRegistrationCache.size,
  }
}
