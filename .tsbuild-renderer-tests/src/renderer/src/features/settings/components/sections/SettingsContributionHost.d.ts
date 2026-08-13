import type { ExtensionContributionRegistryView } from '@shared/types/extensions';
export { SettingsContributionSlot } from './SettingsContributionSlot';
export { SettingsContributionSlotBoundary } from './SettingsContributionSlotBoundary';
export declare function SettingsContributionHost({ registry, }: {
    readonly registry: ExtensionContributionRegistryView | null;
}): import("node_modules/@types/react").JSX.Element | null;
