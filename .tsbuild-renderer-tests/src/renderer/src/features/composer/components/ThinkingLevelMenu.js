import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useComposerStore } from '@/features/composer/state/composer-store';
import { useSelectedModelThinkingLevel } from '@/features/providers/hooks';
import { usePreferencesStore } from '@/features/settings/state';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/Button';
import { Popover } from '@/shared/ui/Popover';
import { THINKING_LEVEL_LABELS } from '../constants/thinking-level-labels';
import { getThinkingButtonLabel, getThinkingButtonTitle, hasOnlyOffThinkingLevel, } from '../lib/thinking-level-view';
export function ThinkingLevelMenu() {
    const settings = usePreferencesStore((s) => s.settings);
    const setThinkingLevel = usePreferencesStore((s) => s.setThinkingLevel);
    const thinkingMenuOpen = useComposerStore((s) => s.thinkingMenuOpen);
    const openMenu = useComposerStore((s) => s.openMenu);
    const thinking = useSelectedModelThinkingLevel();
    const hasSelectedModel = settings.selectedModel.trim().length > 0;
    const canOpenThinkingMenu = thinking.capabilitiesKnown && thinking.availableThinkingLevels.length > 0;
    const selectedModelOnlySupportsOff = thinking.capabilitiesKnown && hasOnlyOffThinkingLevel(thinking.availableThinkingLevels);
    async function handleThinkingLevelChange(level) {
        openMenu(null);
        if (level === settings.thinkingLevel)
            return;
        await setThinkingLevel(level);
    }
    return (_jsx(Popover, { open: thinkingMenuOpen && canOpenThinkingMenu, onOpenChange: (open) => openMenu(open && canOpenThinkingMenu ? 'thinking' : null), placement: "top-start", className: "min-w-[140px] py-1", trigger: _jsx(ThinkingLevelTrigger, { open: thinkingMenuOpen, canOpen: canOpenThinkingMenu, label: getThinkingButtonLabel(hasSelectedModel, thinking.capabilitiesKnown, thinking.effectiveThinkingLevel), title: getThinkingButtonTitle({
                hasSelectedModel,
                capabilitiesKnown: thinking.capabilitiesKnown,
                selectedModelOnlySupportsOff,
                isAdjustedForModel: thinking.isAdjustedForModel,
                requestedThinkingLevel: thinking.requestedThinkingLevel,
                effectiveThinkingLevel: thinking.effectiveThinkingLevel,
            }), onToggle: (nextOpen) => openMenu(nextOpen ? 'thinking' : null) }), children: _jsx(ThinkingLevelOptions, { levels: thinking.availableThinkingLevels, effectiveThinkingLevel: thinking.effectiveThinkingLevel, onSelect: (level) => {
                void handleThinkingLevelChange(level);
            } }) }));
}
function ThinkingLevelTrigger({ open, canOpen, label, title, onToggle, }) {
    return (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => onToggle(!open && canOpen), disabled: !canOpen, className: cn('flex h-[26px] items-center gap-[5px] rounded-md border border-button-border px-2.5 transition-colors', canOpen ? 'hover:bg-bg-hover' : 'cursor-not-allowed opacity-70'), title: title, children: [_jsx("span", { className: "text-[12px] text-text-secondary", children: label }), _jsx("span", { className: "text-[9px] text-text-tertiary", children: "\u2228" })] }));
}
function ThinkingLevelOptions({ levels, effectiveThinkingLevel, onSelect, }) {
    return levels.map((level) => (_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => onSelect(level), className: cn('flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover', effectiveThinkingLevel === level ? 'text-accent' : 'text-text-secondary'), children: [_jsx("span", { children: THINKING_LEVEL_LABELS[level] }), effectiveThinkingLevel === level ? _jsx("span", { children: "\u2022" }) : null] }, level)));
}
