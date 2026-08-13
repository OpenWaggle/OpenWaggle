import type { ExtensionContributionFamily, ExtensionContributionRegistryEntry } from '@shared/types/extensions';
export interface ExtensionContributionFamilyCount {
    readonly family: ExtensionContributionFamily;
    readonly count: number;
}
export interface PackageContributionSummary {
    readonly familyCounts: readonly ExtensionContributionFamilyCount[];
    readonly totalCount: number;
}
export declare function familyCountsFor(entries: readonly ExtensionContributionRegistryEntry[]): ExtensionContributionFamilyCount[];
export declare function summarizePackageContributions(entries: readonly ExtensionContributionRegistryEntry[]): PackageContributionSummary;
