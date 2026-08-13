import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from '@/shared/lib/cn';
import { PackageContributionDetails } from './ExtensionContributionSummary';
const HASH_PREVIEW_LENGTH = 12;
function formatHash(hash) {
    return hash ? `${hash.slice(0, HASH_PREVIEW_LENGTH)}…` : 'Not available';
}
function formatInstallSource(extensionPackage) {
    return extensionPackage.buildPlan?.installSource ?? 'prebuilt';
}
function formatBuildStatus(extensionPackage) {
    return extensionPackage.lifecycle?.buildStatus ?? 'not-run';
}
function formatReloadedAt(lastReloadedAt) {
    return lastReloadedAt ? new Date(lastReloadedAt).toISOString() : 'Never';
}
function MetadataItem({ label, children, valueClassName, }) {
    return (_jsxs("div", { children: [_jsx("span", { className: "text-text-muted", children: label }), _jsx("div", { className: cn('text-text-secondary', valueClassName), children: children })] }));
}
export function PackageMetadata({ extensionPackage, contributionSummary, }) {
    const manifest = extensionPackage.manifest;
    return (_jsxs("div", { className: "mt-4 grid gap-3 text-[12px] text-text-tertiary md:grid-cols-2", children: [_jsx(MetadataItem, { label: "Version", children: manifest?.version ?? 'Unknown' }), _jsx(MetadataItem, { label: "SDK range", children: manifest?.sdkRange ?? 'Unknown' }), _jsx(MetadataItem, { label: "Content hash", valueClassName: "font-mono", children: formatHash(extensionPackage.contentHash) }), _jsx(MetadataItem, { label: "Contributions", children: _jsx(PackageContributionDetails, { summary: contributionSummary, fallbackCount: manifest?.contributionCount ?? 0 }) }), _jsx(MetadataItem, { label: "Install source", children: formatInstallSource(extensionPackage) }), _jsx(MetadataItem, { label: "Build command", valueClassName: "truncate", children: extensionPackage.buildPlan?.command ?? 'Not declared' }), extensionPackage.buildPlan ? (_jsx(MetadataItem, { label: "Build status", valueClassName: "truncate", children: formatBuildStatus(extensionPackage) })) : null, _jsx(MetadataItem, { label: "Last reload", valueClassName: "truncate", children: formatReloadedAt(extensionPackage.lifecycle?.lastReloadedAt) }), extensionPackage.lifecycle?.buildLog ? (_jsx(MetadataItem, { label: "Build log", valueClassName: "truncate font-mono", children: extensionPackage.lifecycle.buildLog })) : null] }));
}
