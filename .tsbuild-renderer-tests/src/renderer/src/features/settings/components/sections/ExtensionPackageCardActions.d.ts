import type { ExtensionPackageSummary } from '@shared/types/extensions';
import { type ExtensionPackageCardActions } from './extension-package-card-model';
export declare function PackageActions({ extensionPackage, busy, projectLabel, actions, }: {
    readonly extensionPackage: ExtensionPackageSummary;
    readonly busy: boolean;
    readonly projectLabel: (projectPath: string) => string;
    readonly actions: ExtensionPackageCardActions;
}): import("node_modules/@types/react").JSX.Element;
