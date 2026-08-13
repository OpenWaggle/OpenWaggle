import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useConnectionModelGroups } from '@/features/providers/hooks';
import { usePreferences, useProviders } from '@/features/settings/hooks/useSettings';
import { ModelGroupAccordion } from './ModelGroupAccordion';
export function AvailableModelsSection() {
    const { settings, setEnabledModels } = usePreferences();
    const { isLoading } = useProviders();
    const groups = useConnectionModelGroups();
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const enabledSet = new Set(settings.enabledModels);
    function toggleGroup(key) {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(key))
                next.delete(key);
            else
                next.add(key);
            return next;
        });
    }
    function handleToggle(_provider, modelRef, enabled) {
        const current = [...settings.enabledModels];
        const next = enabled
            ? [...new Set([...current, modelRef])]
            : current.filter((model) => model !== modelRef);
        void setEnabledModels(next);
    }
    function handleSelectAll(group) {
        const refs = group.models.map((model) => String(model.id));
        void setEnabledModels([...new Set([...settings.enabledModels, ...refs])]);
    }
    function handleClear(group) {
        const modelRefs = new Set(group.models.map((model) => String(model.id)));
        void setEnabledModels([...settings.enabledModels].filter((model) => !modelRefs.has(model)));
    }
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "space-y-1", children: [_jsx("h3", { className: "text-[16px] font-semibold text-text-primary", children: "Available Models" }), _jsx("p", { className: "text-[13px] text-text-tertiary", children: "Choose which models appear in the model selector." })] }), isLoading && groups.length === 0 ? (_jsx("p", { className: "text-[13px] text-text-muted", children: "Loading Pi models\u2026" })) : groups.length === 0 ? (_jsx("p", { className: "text-[13px] text-text-muted", children: "Pi did not report any providers or models." })) : (_jsx("div", { className: "rounded-lg border border-border bg-[#111418] overflow-hidden", children: groups.map((group, i) => (_jsx(ModelGroupAccordion, { group: group, state: {
                        isExpanded: expandedGroups.has(group.key),
                        isLast: i === groups.length - 1,
                        enabledSet,
                    }, actions: {
                        onToggleExpand: toggleGroup,
                        onToggleModel: handleToggle,
                        onSelectAll: handleSelectAll,
                        onClear: handleClear,
                    } }, group.key))) }))] }));
}
