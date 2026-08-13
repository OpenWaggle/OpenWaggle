import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SupportedModelId } from '@shared/types/brand';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { formatContextWindow } from '@/shared/lib/format-tokens';
import { Button } from '@/shared/ui/Button';
import { ModelSelectorDropdown } from './ModelSelectorDropdown';
import { ProviderModelIcon, resolveIconColor } from './provider-icon';
/**
 * enabledModels contains canonical Pi refs: "provider/modelId".
 * The composer only shows curated models that Pi currently reports as runnable.
 */
function toFlatModel(group, model) {
    const modelRef = model.id.trim();
    if (!modelRef || !model.available)
        return null;
    return {
        id: SupportedModelId(modelRef),
        modelId: model.modelId,
        name: model.name.trim() || model.modelId,
        provider: group.provider,
        providerName: group.displayName,
        contextWindowLabel: model.contextWindow ? formatContextWindow(model.contextWindow) : undefined,
    };
}
function buildAvailableModelLookup(providerModels) {
    const modelLookup = new Map();
    for (const group of providerModels) {
        for (const model of group.models) {
            const flatModel = toFlatModel(group, model);
            if (flatModel)
                modelLookup.set(flatModel.id, flatModel);
        }
    }
    return modelLookup;
}
function readEnabledModel(modelKey, modelLookup, seen) {
    const modelRef = modelKey.trim();
    if (seen.has(modelRef))
        return null;
    seen.add(modelRef);
    return modelLookup.get(modelRef) ?? null;
}
function sortModelsByProvider(models) {
    return models.slice().sort((a, b) => {
        if (a.provider !== b.provider)
            return a.provider.localeCompare(b.provider);
        return 0;
    });
}
function buildFlatModels(providerModels, settings) {
    if (settings.enabledModels.length === 0)
        return [];
    const modelLookup = buildAvailableModelLookup(providerModels);
    const models = [];
    const seen = new Set();
    for (const key of settings.enabledModels) {
        const model = readEnabledModel(key, modelLookup, seen);
        if (model)
            models.push(model);
    }
    return sortModelsByProvider(models);
}
function SelectedModelIcon({ provider }) {
    const color = resolveIconColor(provider);
    return _jsx(ProviderModelIcon, { provider: provider, className: "size-3.5 shrink-0", style: { color } });
}
export function ModelSelector({ value, onChange, settings, providerModels, className, }) {
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef(null);
    const dropdownRef = useRef(null);
    const flatModels = buildFlatModels(providerModels, settings);
    const selectedModel = flatModels.find((m) => m.id === value);
    // Outside-click handler
    useEffect(() => {
        if (!isOpen)
            return;
        function onMouseDown(event) {
            if (!(event.target instanceof Node))
                return;
            if (ref.current?.contains(event.target))
                return;
            if (dropdownRef.current?.contains(event.target))
                return;
            setIsOpen(false);
        }
        document.addEventListener('mousedown', onMouseDown);
        return () => {
            document.removeEventListener('mousedown', onMouseDown);
        };
    }, [isOpen]);
    function selectModel(model) {
        onChange(model.id);
        setIsOpen(false);
    }
    function handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            setIsOpen(false);
        }
    }
    function triggerKeyDown(event) {
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
            event.preventDefault();
            setIsOpen(true);
        }
    }
    return (_jsxs("div", { ref: ref, className: cn('relative', className), children: [_jsxs(Button, { variant: "unstyled", type: "button", onClick: () => setIsOpen(!isOpen), onKeyDown: triggerKeyDown, "aria-expanded": isOpen, "aria-haspopup": "listbox", className: cn('no-drag flex h-[26px] items-center gap-[5px] rounded-md border border-button-border px-2.5 transition-colors hover:bg-bg-hover hover:text-text-primary', selectedModel ? 'text-text-secondary' : 'text-text-muted'), children: [selectedModel && _jsx(SelectedModelIcon, { provider: selectedModel.provider }), _jsx("span", { className: "max-w-[180px] truncate text-[12px]", children: selectedModel?.name ?? 'Select model' }), _jsx("span", { className: "text-[9px] text-text-tertiary", children: "\u2228" })] }), isOpen && (_jsx(ModelSelectorDropdown, { dropdownRef: dropdownRef, models: flatModels, selectedModel: selectedModel, onKeyDown: handleKeyDown, onSelectModel: selectModel }))] }));
}
