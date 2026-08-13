import type { ExtensionPackageSummary } from '@shared/types/extensions';
import type { PackageContributionSummary } from './extension-contribution-summary-model';
export declare function PackageMetadata({ extensionPackage, contributionSummary, }: {
    readonly extensionPackage: ExtensionPackageSummary;
    readonly contributionSummary: PackageContributionSummary | null;
}): import("node_modules/@types/react").JSX.Element;
