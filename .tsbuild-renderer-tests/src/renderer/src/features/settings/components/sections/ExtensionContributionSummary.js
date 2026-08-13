import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { familyCountsFor } from './extension-contribution-summary-model';
const FAMILY_LABELS = {
    commands: 'Commands',
    slashCommands: 'Slash commands',
    routes: 'Routes',
    settingsSections: 'Settings',
    sidePanels: 'Side panels',
    dialogs: 'Dialogs',
    transcriptRenderers: 'Transcript',
    toolRenderers: 'Tools',
    customMessageRenderers: 'Custom messages',
    interactionRenderers: 'Interactions',
    statusWidgets: 'Status',
};
function positiveCounts(counts) {
    return counts.filter((entry) => entry.count > 0);
}
function declaredTotal(packages) {
    return packages.reduce((total, extensionPackage) => total + (extensionPackage.manifest?.contributionCount ?? 0), 0);
}
function contributionStats({ registry, packages, }) {
    if (!registry) {
        return [{ label: 'Declared contributions', value: declaredTotal(packages) }];
    }
    const familyCounts = familyCountsFor(registry.entries);
    const packageKeys = new Set(registry.entries.map((entry) => entry.packagePath));
    return [
        { label: 'Registry contributions', value: registry.entries.length },
        { label: 'Families', value: positiveCounts(familyCounts).length },
        { label: 'Packages', value: packageKeys.size },
    ];
}
function ContributionStat({ label, value }) {
    return (_jsxs("div", { className: "rounded-lg border border-border/70 bg-[#111418] px-3 py-2", children: [_jsx("div", { className: "text-[18px] font-semibold text-text-primary", children: value }), _jsx("div", { className: "text-[11px] text-text-muted", children: label })] }));
}
export function ExtensionContributionSummary({ registry, packages, }) {
    const stats = contributionStats({ registry, packages });
    return (_jsx("section", { "aria-label": "Extension contribution summary", className: "grid gap-2 rounded-xl border border-border bg-bg-secondary/30 p-3 sm:grid-cols-3", children: stats.map((stat) => (_jsx(ContributionStat, { label: stat.label, value: stat.value }, stat.label))) }));
}
export function PackageContributionDetails({ summary, fallbackCount, }) {
    if (!summary) {
        return _jsx(_Fragment, { children: fallbackCount });
    }
    const familyCounts = positiveCounts(summary.familyCounts);
    return (_jsxs("div", { className: "space-y-1", children: [_jsx("div", { children: summary.totalCount }), familyCounts.length > 0 ? (_jsx("div", { className: "flex flex-wrap gap-1", children: familyCounts.map((entry) => (_jsxs("span", { className: "rounded border border-border/70 bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary", children: [FAMILY_LABELS[entry.family], " ", entry.count] }, entry.family))) })) : (_jsx("span", { className: "text-[11px] text-text-muted", children: "No families" }))] }));
}
