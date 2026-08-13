import type { ExtensionPackageSummary } from '@shared/types/extensions';
export declare function ProjectOverrideActions({ extensionPackage, busy, projectLabel, onSetProjectDisabled, }: {
    readonly extensionPackage: ExtensionPackageSummary;
    readonly busy: boolean;
    readonly projectLabel: (projectPath: string) => string;
    readonly onSetProjectDisabled: (projectPath: string, disabled: boolean) => void;
}): import("node_modules/@types/react").JSX.Element;
