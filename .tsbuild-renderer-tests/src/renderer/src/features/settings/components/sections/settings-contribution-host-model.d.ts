import type { ExtensionContributionRegistryEntry, ExtensionContributionRegistryView } from '@shared/types/extensions';
export type ContributionPillTone = 'neutral' | 'good' | 'warning' | 'error';
export declare function contributionPillToneClassName(tone: ContributionPillTone): "bg-emerald-500/10 text-emerald-300" | "bg-amber-500/10 text-amber-300" | "bg-error/10 text-error" | "bg-bg-tertiary text-text-tertiary";
export declare function eligibilityPills(entry: ExtensionContributionRegistryEntry): {
    readonly label: string;
    readonly tone: ContributionPillTone;
}[];
export declare function settingsContributionEntries(registry: ExtensionContributionRegistryView | null): readonly ExtensionContributionRegistryEntry[];
export declare function contributionKey(entry: ExtensionContributionRegistryEntry): string;
