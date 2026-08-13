import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PackageOpen } from 'lucide-react';
import { ExtensionDiagnostics } from './ExtensionDiagnostics';
import { ManifestBadges } from './ExtensionManifestBadges';
import { PackageActions } from './ExtensionPackageCardActions';
import { PackageStatusPills, PackageTrustIcon } from './ExtensionPackageCardStatus';
import { PackageMetadata } from './ExtensionPackageMetadata';
import { ExtensionPackageRequirements } from './ExtensionPackageRequirements';
import { packageTitle, visiblePackageDiagnostics, } from './extension-package-card-model';
export function ExtensionPackageCard({ extensionPackage, contributionSummary, busy, projectLabel, actions, }) {
    return (_jsxs("div", { className: "rounded-lg border border-border bg-[#111418] p-4", children: [_jsxs("div", { className: "flex items-start justify-between gap-4", children: [_jsxs("div", { className: "min-w-0", children: [_jsxs("div", { className: "flex flex-wrap items-center gap-2", children: [_jsx(PackageOpen, { className: "size-4 text-accent" }), _jsx("h3", { className: "text-[15px] font-semibold text-text-primary", children: packageTitle(extensionPackage) }), _jsx(PackageStatusPills, { extensionPackage: extensionPackage })] }), _jsx("div", { className: "mt-1 truncate text-[12px] text-text-muted", children: extensionPackage.packagePath })] }), _jsx(PackageTrustIcon, { extensionPackage: extensionPackage })] }), _jsx(PackageMetadata, { extensionPackage: extensionPackage, contributionSummary: contributionSummary }), _jsx(ExtensionPackageRequirements, { requirements: extensionPackage.requirements }), _jsx(PackageActions, { extensionPackage: extensionPackage, busy: busy, projectLabel: projectLabel, actions: actions }), _jsx(ManifestBadges, { extensionPackage: extensionPackage }), _jsx(ExtensionDiagnostics, { diagnostics: visiblePackageDiagnostics(extensionPackage) })] }));
}
