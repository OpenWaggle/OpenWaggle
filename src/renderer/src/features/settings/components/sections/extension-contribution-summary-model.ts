import type {
  ExtensionContributionFamily,
  ExtensionContributionRegistryEntry,
} from '@shared/types/extensions'

export interface ExtensionContributionFamilyCount {
  readonly family: ExtensionContributionFamily
  readonly count: number
}

export interface PackageContributionSummary {
  readonly familyCounts: readonly ExtensionContributionFamilyCount[]
  readonly totalCount: number
}

function addFamilyCount(
  counts: ExtensionContributionFamilyCount[],
  family: ExtensionContributionFamily,
) {
  const existing = counts.find((entry) => entry.family === family)
  if (existing) {
    counts.splice(counts.indexOf(existing), 1, {
      family,
      count: existing.count + 1,
    })
    return
  }

  counts.push({ family, count: 1 })
}

export function familyCountsFor(entries: readonly ExtensionContributionRegistryEntry[]) {
  const counts: ExtensionContributionFamilyCount[] = []
  for (const entry of entries) {
    addFamilyCount(counts, entry.family)
  }
  return counts
}

export function summarizePackageContributions(
  entries: readonly ExtensionContributionRegistryEntry[],
): PackageContributionSummary {
  return {
    familyCounts: familyCountsFor(entries),
    totalCount: entries.length,
  }
}
