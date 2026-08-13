import type { ExtensionContributionRegistryView, ExtensionPackageSummary } from '@shared/types/extensions';
import type { PackageContributionSummary } from './extension-contribution-summary-model';
export declare function ExtensionContributionSummary({ registry, packages, }: {
    readonly registry: ExtensionContributionRegistryView | null;
    readonly packages: readonly ExtensionPackageSummary[];
}): import("node_modules/@types/react").JSX.Element;
export declare function PackageContributionDetails({ summary, fallbackCount, }: {
    readonly summary: PackageContributionSummary | null;
    readonly fallbackCount: number;
}): import("node_modules/@types/react").JSX.Element;
