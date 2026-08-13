import type { ExtensionInvokeScope } from '@shared/types/extension-broker';
import type { ExtensionContributionRegistryEntry, ExtensionContributionRegistryView } from '@shared/types/extensions';
import type { CommandPaletteItem } from '../model';
export interface ExtensionCommandActionInput {
    readonly entry: ExtensionContributionRegistryEntry;
}
export type InvokeExtensionCommand = (input: ExtensionCommandActionInput) => void;
export type CanInvokeExtensionCommand = (entry: ExtensionContributionRegistryEntry) => boolean;
export declare function resolveExtensionCommandInvocationScope(input: {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly projectPath: string | null | undefined;
    readonly sessionId?: string | null;
}): ExtensionInvokeScope | null;
export interface ExtensionSlashCommandActionInput {
    readonly entry: ExtensionContributionRegistryEntry;
}
export type InsertExtensionSlashCommand = (input: ExtensionSlashCommandActionInput) => void;
export interface ExtensionSidePanelActionInput {
    readonly entry: ExtensionContributionRegistryEntry;
}
export type OpenExtensionSidePanel = (input: ExtensionSidePanelActionInput) => void;
export declare function createExtensionCommandItems({ registry, lowerQuery, invokeCommand, canInvokeCommand, }: {
    readonly registry: ExtensionContributionRegistryView | null;
    readonly lowerQuery: string;
    readonly invokeCommand: InvokeExtensionCommand;
    readonly canInvokeCommand?: CanInvokeExtensionCommand;
}): CommandPaletteItem[];
export declare function createExtensionSlashCommandItems({ registry, lowerQuery, insertCommand, }: {
    readonly registry: ExtensionContributionRegistryView | null;
    readonly lowerQuery: string;
    readonly insertCommand: InsertExtensionSlashCommand;
}): CommandPaletteItem[];
export declare function createExtensionSidePanelItems({ registry, lowerQuery, openSidePanel, }: {
    readonly registry: ExtensionContributionRegistryView | null;
    readonly lowerQuery: string;
    readonly openSidePanel: OpenExtensionSidePanel;
}): CommandPaletteItem[];
