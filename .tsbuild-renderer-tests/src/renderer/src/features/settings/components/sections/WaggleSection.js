import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { usePreferences, useProviders } from '@/features/settings/hooks/useSettings';
import { useWaggleForm } from '../../hooks/useWaggleForm';
import { WaggleAgentSlotCard } from './WaggleAgentSlotCard';
import { CollaborationSettingsCard } from './WaggleCollaborationSettingsCard';
import { WagglePresetsPanel } from './WagglePresetsPanel';
export function WaggleSection() {
    const { settings } = usePreferences();
    const { providerModels } = useProviders();
    const { formState, dispatchForm, presets, activePresetId, isModified, displayedError, loadPreset, handleSaveEdits, handleNewCustom, handleDeletePreset, } = useWaggleForm();
    const [agentA, agentB] = formState.agents;
    return (_jsxs("div", { className: "space-y-6", children: [_jsx("h2", { className: "text-[20px] font-semibold text-text-primary", children: "Waggle Mode" }), displayedError && (_jsx("p", { role: "alert", className: "rounded-lg border border-error/25 bg-error/6 px-3 py-2 text-sm text-error", children: displayedError })), _jsx(WagglePresetsPanel, { presets: presets, activePresetId: activePresetId, isModified: isModified, onLoadPreset: loadPreset, onDeletePreset: handleDeletePreset, onSaveEdits: handleSaveEdits, onNewCustom: handleNewCustom }), _jsx(WaggleAgentSlotCard, { index: 0, agent: agentA, dispatchForm: dispatchForm, dotLabel: "A", settings: settings, providerModels: providerModels }), _jsx(WaggleAgentSlotCard, { index: 1, agent: agentB, dispatchForm: dispatchForm, dotLabel: "B", settings: settings, providerModels: providerModels }), _jsx(CollaborationSettingsCard, { stopCondition: formState.stopCondition, maxTurns: formState.maxTurns, onStopConditionChange: (stopCondition) => dispatchForm({ type: 'set-stop-condition', stopCondition }), onMaxTurnsChange: (maxTurns) => dispatchForm({ type: 'set-max-turns', maxTurns }) })] }));
}
