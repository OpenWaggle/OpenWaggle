import type { ExtensionPackageSummary } from '@shared/types/extensions';
export declare function ReloadAction({ extensionPackage, busy, enabled, onReload, }: {
    readonly extensionPackage: ExtensionPackageSummary;
    readonly busy: boolean;
    readonly enabled: boolean;
    readonly onReload: () => void;
}): import("node_modules/@types/react").JSX.Element | null;
export declare function RemoveAction({ extensionPackage, busy, onRemove, }: {
    readonly extensionPackage: ExtensionPackageSummary;
    readonly busy: boolean;
    readonly onRemove: () => void;
}): import("node_modules/@types/react").JSX.Element;
