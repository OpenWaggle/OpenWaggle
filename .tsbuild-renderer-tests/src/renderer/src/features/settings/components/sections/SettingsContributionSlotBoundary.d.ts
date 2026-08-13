import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions';
import type { ReactNode } from 'react';
export declare function SettingsContributionSlotBoundary({ entry, children, }: {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly children: ReactNode;
}): import("node_modules/@types/react").JSX.Element;
