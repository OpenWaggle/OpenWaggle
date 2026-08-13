import type { ExtensionPackageSummary } from '@shared/types/extensions';
import type { PackageContributionSummary } from './extension-contribution-summary-model';
import { type ExtensionPackageCardActions } from './extension-package-card-model';
export declare function ExtensionPackageCard({ extensionPackage, contributionSummary, busy, projectLabel, actions, }: {
    readonly extensionPackage: ExtensionPackageSummary;
    readonly contributionSummary: PackageContributionSummary | null;
    readonly busy: boolean;
    readonly projectLabel: (projectPath: string) => string;
    readonly actions: ExtensionPackageCardActions;
}): import("node_modules/@types/react").JSX.Element;
