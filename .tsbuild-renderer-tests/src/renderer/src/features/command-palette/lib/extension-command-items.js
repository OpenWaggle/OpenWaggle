import { jsx as _jsx } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { PackageOpen, PanelRight } from 'lucide-react';
import { extensionContributionMatches, extensionSlashCommandText, isInvokableExtensionContributionCommand, isInvokableExtensionSlashCommandEntry, } from '@/features/composer/commands';
import { COMMAND_PALETTE } from '../constants/command-palette';
import { truncateCommandDescription } from './command-palette-text';
export function resolveExtensionCommandInvocationScope(input) {
    const { entry, projectPath, sessionId } = input;
    const declaredScopes = entry.declaredScopes;
    if (declaredScopes === undefined) {
        return projectPath ? { kind: 'project', projectPath } : { kind: 'app' };
    }
    if (projectPath &&
        sessionId &&
        declaredScopes.includes('session') &&
        entry.projectPaths.includes(projectPath)) {
        return { kind: 'session', projectPath, sessionId };
    }
    if (projectPath &&
        declaredScopes.includes('project') &&
        entry.projectPaths.includes(projectPath)) {
        return { kind: 'project', projectPath };
    }
    if (declaredScopes.includes('app')) {
        return { kind: 'app' };
    }
    return null;
}
export function createExtensionCommandItems({ registry, lowerQuery, invokeCommand, canInvokeCommand = () => true, }) {
    if (registry === null) {
        return [];
    }
    const items = [];
    for (const entry of registry.entries) {
        if (!isExecutableCommandEntry(entry) ||
            !extensionContributionMatches(entry, lowerQuery) ||
            !canInvokeCommand(entry)) {
            continue;
        }
        items.push({
            id: `extension-command:${entry.extensionId}:${entry.contributionId}`,
            label: entry.title,
            description: truncateCommandDescription(`Extension command from ${entry.extensionName}`, COMMAND_PALETTE.DESCRIPTION_LIMIT),
            icon: _jsx(PackageOpen, { className: "size-3.5" }),
            section: entry.category ?? 'Extensions',
            trailing: entry.extensionName,
            trailingBadge: entry.scope.label,
            action: () => invokeCommand({ entry }),
        });
    }
    return items;
}
export function createExtensionSlashCommandItems({ registry, lowerQuery, insertCommand, }) {
    if (registry === null) {
        return [];
    }
    const items = [];
    for (const entry of registry.entries) {
        if (!isInvokableExtensionSlashCommandEntry(entry) ||
            !extensionContributionMatches(entry, lowerQuery)) {
            continue;
        }
        items.push({
            id: `extension-slash-command:${entry.extensionId}:${entry.contributionId}`,
            label: entry.title,
            description: truncateCommandDescription(`Insert ${extensionSlashCommandText(entry)} from ${entry.extensionName}`, COMMAND_PALETTE.DESCRIPTION_LIMIT),
            icon: _jsx(PackageOpen, { className: "size-3.5" }),
            section: entry.category ?? 'Extensions',
            trailing: extensionSlashCommandText(entry),
            trailingBadge: entry.scope.label,
            action: () => insertCommand({ entry }),
        });
    }
    return items;
}
export function createExtensionSidePanelItems({ registry, lowerQuery, openSidePanel, }) {
    if (registry === null) {
        return [];
    }
    const items = [];
    for (const entry of registry.entries) {
        if (!isOpenableSidePanelEntry(entry) || !extensionContributionMatches(entry, lowerQuery)) {
            continue;
        }
        items.push({
            id: `extension-side-panel:${entry.packagePath}:${entry.contentHash}:${entry.contributionId}`,
            label: entry.title,
            description: truncateCommandDescription(`Open side panel from ${entry.extensionName}`, COMMAND_PALETTE.DESCRIPTION_LIMIT),
            icon: _jsx(PanelRight, { className: "size-3.5" }),
            section: entry.category ?? 'Extensions',
            trailing: entry.extensionName,
            trailingBadge: entry.scope.label,
            action: () => openSidePanel({ entry }),
        });
    }
    return items;
}
function isExecutableCommandEntry(entry) {
    return isInvokableExtensionContributionCommand(entry, OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS);
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
function isOpenableSidePanelEntry(entry) {
    return (entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.SIDE_PANELS &&
        entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE &&
        entry.execution !== undefined &&
        entry.entryPath !== undefined &&
        extensionContributionIsEligible(entry));
}
