import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { SettingsContributionSlot } from './SettingsContributionSlot';
import { SettingsContributionSlotBoundary } from './SettingsContributionSlotBoundary';
import { contributionKey, settingsContributionEntries } from './settings-contribution-host-model';
export { SettingsContributionSlot } from './SettingsContributionSlot';
export { SettingsContributionSlotBoundary } from './SettingsContributionSlotBoundary';
export function SettingsContributionHost({ registry, }) {
    const entries = settingsContributionEntries(registry);
    if (entries.length === 0) {
        return null;
    }
    return (_jsxs("section", { "aria-label": "Extension settings contributions", className: "space-y-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-[13px] font-semibold text-text-secondary", children: "Extension settings" }), _jsxs("p", { className: "mt-0.5 text-[11px] text-text-muted", children: [entries.length, " settings section", entries.length === 1 ? '' : 's', " from enabled extensions."] })] }), _jsx("div", { className: "space-y-3", children: entries.map((entry) => (_jsx(SettingsContributionSlotBoundary, { entry: entry, children: _jsx(SettingsContributionSlot, { entry: entry }) }, contributionKey(entry)))) })] }));
}
