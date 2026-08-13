import type { ExtensionPackageSummary } from '@shared/types/extensions';
export interface ExtensionPackageCardActions {
    readonly onSetTrusted: (trusted: boolean) => void;
    readonly onSetEnabled: (enabled: boolean) => void;
    readonly onSetProjectDisabled: (projectPath: string, disabled: boolean) => void;
    readonly onAcceptUpdate: () => void;
    readonly onApproveBuild: () => void;
    readonly onReload: () => void;
    readonly onRemove: () => void;
}
export declare function packageTitle(extensionPackage: ExtensionPackageSummary): string;
export declare function hasErrorDiagnostics(extensionPackage: ExtensionPackageSummary): boolean;
export declare function visiblePackageDiagnostics(extensionPackage: ExtensionPackageSummary): import("@shared/types/extensions").ExtensionDiagnosticView[];
export declare function isSdkCompatible(extensionPackage: ExtensionPackageSummary): boolean;
export declare function isBuildPlanApproved(extensionPackage: ExtensionPackageSummary): boolean;
