import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { BUILT_IN_COMPOSER_SLASH_COMMANDS } from './built-in-slash-commands';
const SLASH_COMMAND_PREFIX = '/';
export function isInvokableExtensionContributionCommand(entry, family) {
    return (entry.family === family &&
        entry.capability !== undefined &&
        entry.method !== undefined &&
        extensionContributionIsEligible(entry));
}
export function isInvokableExtensionSlashCommandEntry(entry) {
    return (isInvokableExtensionContributionCommand(entry, OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SLASH_COMMANDS) && !BUILT_IN_COMPOSER_SLASH_COMMANDS.includes(extensionSlashCommandText(entry)));
}
export function invokableExtensionSlashCommandEntries(registry) {
    if (registry === null) {
        return [];
    }
    return registry.entries.filter(isInvokableExtensionSlashCommandEntry);
}
export function extensionSlashCommandText(entry) {
    return `${SLASH_COMMAND_PREFIX}${entry.contributionId}`;
}
export function extensionContributionMatches(entry, lowerQuery) {
    return (lowerQuery.length === 0 ||
        entry.title.toLowerCase().includes(lowerQuery) ||
        entry.extensionName.toLowerCase().includes(lowerQuery) ||
        entry.contributionId.includes(lowerQuery) ||
        Boolean(entry.category?.toLowerCase().includes(lowerQuery)));
}
export function parseExtensionSlashCommand(text, registry) {
    const parsed = splitSlashCommandInput(text);
    if (!parsed) {
        return null;
    }
    const entry = invokableExtensionSlashCommandEntries(registry).find((candidate) => extensionSlashCommandText(candidate) === parsed.command) ?? null;
    if (!entry) {
        return null;
    }
    return {
        entry,
        command: parsed.command,
        args: parsed.args,
        rawText: parsed.rawText,
    };
}
export function extensionSlashCommandPayload(command) {
    return {
        command: command.command,
        args: command.args,
        rawText: command.rawText,
    };
}
function extensionContributionIsEligible(entry) {
    const eligibility = entry.eligibility;
    return (eligibility.runtimeEnabled &&
        eligibility.enabled &&
        eligibility.trusted &&
        eligibility.sdkCompatible !== false &&
        !eligibility.updateAvailable &&
        eligibility.disabledProjectPaths.length === 0);
}
function splitSlashCommandInput(text) {
    const rawText = text.trim();
    if (!rawText.startsWith(SLASH_COMMAND_PREFIX)) {
        return null;
    }
    const firstWhitespace = rawText.search(/\s/);
    if (firstWhitespace < 0) {
        return { command: rawText, args: '', rawText };
    }
    return {
        command: rawText.slice(0, firstWhitespace),
        args: rawText.slice(firstWhitespace).trim(),
        rawText,
    };
}
