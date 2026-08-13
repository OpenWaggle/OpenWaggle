import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Settings2 } from 'lucide-react';
import { ExtensionDiagnostics } from './ExtensionDiagnostics';
import { SettingsContributionPill } from './SettingsContributionPill';
import { SettingsContributionRuntimeBody } from './SettingsContributionRuntimeBody';
import { eligibilityPills } from './settings-contribution-host-model';
export function SettingsContributionSlot({ entry, }) {
    const extraPills = eligibilityPills(entry);
    return (_jsxs("article", { className: "rounded-lg border border-border bg-[#111418] p-4", children: [_jsx("div", { className: "flex items-start justify-between gap-4", children: _jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(Settings2, { className: "size-4 text-accent" }), _jsx("h3", { className: "text-[15px] font-semibold text-text-primary", children: entry.title }), extraPills.map((pill) => (_jsx(SettingsContributionPill, { tone: pill.tone, children: pill.label }, pill.label)))] }), _jsx("div", { className: "mt-1 truncate text-[12px] text-text-muted", children: entry.extensionName })] }) }), _jsx("div", { className: "mt-4", children: _jsx(SettingsContributionRuntimeBody, { entry: entry }) }), _jsx(ExtensionDiagnostics, { diagnostics: entry.diagnostics })] }));
}
