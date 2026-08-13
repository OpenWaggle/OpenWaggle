import { jsx as _jsx } from "react/jsx-runtime";
import { Archive, Copy, GitBranch, GitPullRequest, ListTree, MessageSquare, Settings, Shield, ShieldAlert, Swords, User, Waypoints, } from 'lucide-react';
import { COMMAND_PALETTE } from '../constants/command-palette';
import { openFeedbackModal } from './command-palette-actions';
import { truncateCommandDescription } from './command-palette-text';
export function createBaseCommands(actions) {
    const optionalCommands = [];
    appendOptionalCommand(optionalCommands, createSessionTreeCommand(actions));
    appendOptionalCommand(optionalCommands, createForkCommand(actions));
    appendOptionalCommand(optionalCommands, createCloneCommand(actions));
    appendOptionalCommand(optionalCommands, createWorktreesCommand(actions));
    return [
        {
            id: 'waggle',
            label: 'Waggle Mode',
            description: 'Start LLM collaboration session',
            icon: _jsx(Waypoints, { className: "size-3.5" }),
            action: actions.startWaggle,
        },
        {
            id: 'feedback',
            label: 'Feedback',
            icon: _jsx(MessageSquare, { className: "size-3.5" }),
            action: openFeedbackModal,
        },
        {
            id: 'compact',
            label: 'Compact session',
            description: 'Run /compact with optional instructions',
            icon: _jsx(Archive, { className: "size-3.5" }),
            action: actions.insertCompactCommand,
        },
        ...optionalCommands,
    ];
}
export function filterBaseCommands(commands, lowerQuery) {
    if (!lowerQuery)
        return commands;
    return commands.filter((command) => commandMatchesQuery(command, lowerQuery));
}
export function createSkillItems(slashSkills, lowerQuery, selectSkill) {
    const items = [];
    for (const skill of slashSkills) {
        if (!skill.enabled || skill.loadStatus !== 'ok')
            continue;
        if (!skillMatchesQuery(skill, lowerQuery))
            continue;
        items.push({
            id: `skill-${skill.id}`,
            label: skill.name,
            description: truncateCommandDescription(skill.description, COMMAND_PALETTE.DESCRIPTION_LIMIT),
            icon: _jsx(Shield, { className: "size-3.5" }),
            section: 'Skills',
            action: () => selectSkill(skill.id, skill.name),
        });
    }
    return items;
}
export function createPresetItems(presets, lowerQuery, selectPreset) {
    const items = [];
    for (const preset of presets) {
        if (!presetMatchesQuery(preset, lowerQuery))
            continue;
        items.push({
            id: `waggle-preset-${preset.id}`,
            label: preset.name,
            description: truncateCommandDescription(preset.description, COMMAND_PALETTE.WAGGLE_PRESET_DESCRIPTION_LIMIT),
            icon: presetIcon(preset),
            section: 'Waggle Mode',
            trailing: 'Sequential',
            trailingBadge: preset.isBuiltIn ? undefined : 'Custom',
            action: () => selectPreset(preset),
        });
    }
    return items;
}
export function createConfigureWaggleItem(lowerQuery, configureWaggle) {
    if (!isWaggleFilter(lowerQuery))
        return [];
    return [
        {
            id: 'configure-waggle',
            label: 'Configure Waggle Mode...',
            description: 'Open Waggle Mode settings',
            icon: _jsx(Settings, { className: "size-3.5" }),
            section: 'configure',
            action: configureWaggle,
        },
    ];
}
function createSessionTreeCommand(actions) {
    if (!actions.openSessionTree)
        return null;
    return {
        id: 'session-tree',
        label: 'Open Session Tree',
        description: 'Navigate the Pi session tree',
        icon: _jsx(ListTree, { className: "size-3.5" }),
        action: actions.openSessionTree,
    };
}
function createForkCommand(actions) {
    if (!actions.forkToNewSession)
        return null;
    return {
        id: 'session-fork-to-new',
        label: 'Fork to new session...',
        description: 'Select a previous user message and continue in a new session',
        icon: _jsx(GitBranch, { className: "size-3.5" }),
        action: actions.forkToNewSession,
    };
}
function createCloneCommand(actions) {
    if (!actions.cloneToNewSession)
        return null;
    return {
        id: 'session-clone-to-new',
        label: 'Clone to new session',
        description: 'Duplicate the current session position',
        icon: _jsx(Copy, { className: "size-3.5" }),
        action: actions.cloneToNewSession,
    };
}
function createWorktreesCommand(actions) {
    if (!actions.openWorktrees)
        return null;
    return {
        id: 'new-worktree',
        label: 'Manage worktrees',
        description: 'Open the Worktrees settings surface',
        icon: _jsx(GitBranch, { className: "size-3.5" }),
        action: actions.openWorktrees,
    };
}
function commandMatchesQuery(command, lowerQuery) {
    return (command.label.toLowerCase().includes(lowerQuery) ||
        Boolean(command.description?.toLowerCase().includes(lowerQuery)));
}
function skillMatchesQuery(skill, lowerQuery) {
    return (!lowerQuery ||
        skill.name.toLowerCase().includes(lowerQuery) ||
        skill.id.includes(lowerQuery) ||
        skill.description.toLowerCase().includes(lowerQuery));
}
function presetMatchesQuery(preset, lowerQuery) {
    return (!lowerQuery ||
        preset.name.toLowerCase().includes(lowerQuery) ||
        COMMAND_PALETTE.WAGGLE_QUERY.includes(lowerQuery));
}
function isWaggleFilter(lowerQuery) {
    return (lowerQuery.length > 0 &&
        COMMAND_PALETTE.WAGGLE_QUERY.includes(lowerQuery) &&
        !lowerQuery.startsWith(COMMAND_PALETTE.WAGGLE_COMMAND_PREFIX));
}
function presetIcon(preset) {
    const name = preset.name.toLowerCase();
    if (name.includes('review'))
        return _jsx(GitPullRequest, { className: "size-3.5" });
    if (name.includes('debate'))
        return _jsx(Swords, { className: "size-3.5" });
    if (name.includes('red team'))
        return _jsx(ShieldAlert, { className: "size-3.5" });
    if (name.includes('qa') || name.includes('test'))
        return _jsx(Shield, { className: "size-3.5" });
    return _jsx(User, { className: "size-3.5" });
}
function appendOptionalCommand(commands, command) {
    if (command) {
        commands.push(command);
    }
}
