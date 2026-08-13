import type { ExtensionContributionFamily, ExtensionContributionRegistryEntry, ExtensionContributionRegistryView } from '@shared/types/extensions';
export interface ExtensionSlashCommand {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly command: string;
    readonly args: string;
    readonly rawText: string;
}
export interface ExtensionSlashCommandPayload {
    readonly command: string;
    readonly args: string;
    readonly rawText: string;
}
export declare function isInvokableExtensionContributionCommand(entry: ExtensionContributionRegistryEntry, family: ExtensionContributionFamily): boolean;
export declare function isInvokableExtensionSlashCommandEntry(entry: ExtensionContributionRegistryEntry): boolean;
export declare function invokableExtensionSlashCommandEntries(registry: ExtensionContributionRegistryView | null): ExtensionContributionRegistryEntry[];
export declare function extensionSlashCommandText(entry: ExtensionContributionRegistryEntry): string;
export declare function extensionContributionMatches(entry: ExtensionContributionRegistryEntry, lowerQuery: string): boolean;
export declare function parseExtensionSlashCommand(text: string, registry: ExtensionContributionRegistryView | null): {
    entry: ExtensionContributionRegistryEntry;
    command: string;
    args: string;
    rawText: string;
} | null;
export declare function extensionSlashCommandPayload(command: ExtensionSlashCommand): ExtensionSlashCommandPayload;
