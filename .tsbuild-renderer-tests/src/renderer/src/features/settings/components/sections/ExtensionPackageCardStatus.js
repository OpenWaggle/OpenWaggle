import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { match } from '@diegogbrisa/ts-match';
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { hasErrorDiagnostics, isBuildPlanApproved, isSdkCompatible, } from './extension-package-card-model';
function StatusPill({ children, tone, }) {
    const toneClassName = match(tone)
        .with('good', () => 'bg-emerald-500/10 text-emerald-300')
        .with('warning', () => 'bg-amber-500/10 text-amber-300')
        .with('error', () => 'bg-error/10 text-error')
        .with('neutral', () => 'bg-bg-tertiary text-text-tertiary')
        .exhaustive();
    return (_jsx("span", { className: cn('rounded px-1.5 py-0.5 text-[10px] font-medium', toneClassName), children: children }));
}
function projectOverridePill(projectOverride) {
    if (!projectOverride) {
        return null;
    }
    return projectOverride.disabled
        ? {
            tone: 'warning',
            label: OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.DISABLED_LABEL,
        }
        : {
            tone: 'neutral',
            label: OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.ACTIVE_LABEL,
        };
}
function projectOverridesSummaryPill(extensionPackage) {
    if (extensionPackage.projectOverride || extensionPackage.projectOverrides.length === 0) {
        return null;
    }
    const disabledCount = extensionPackage.projectOverrides.filter((projectOverride) => projectOverride.disabled).length;
    if (disabledCount === 0) {
        return { tone: 'neutral', label: 'All projects active' };
    }
    return {
        tone: 'warning',
        label: `${disabledCount} project opt-out${disabledCount === 1 ? '' : 's'}`,
    };
}
function sdkStatusPill(extensionPackage) {
    if (hasErrorDiagnostics(extensionPackage)) {
        return { tone: 'error', label: 'Invalid' };
    }
    if (isSdkCompatible(extensionPackage)) {
        return { tone: 'good', label: 'SDK compatible' };
    }
    return { tone: 'warning', label: 'SDK blocked' };
}
function ProjectStatusPills({ extensionPackage, }) {
    const projectStatus = projectOverridePill(extensionPackage.projectOverride);
    const projectSummaryStatus = projectOverridesSummaryPill(extensionPackage);
    return (_jsxs(_Fragment, { children: [projectStatus ? (_jsx(StatusPill, { tone: projectStatus.tone, children: projectStatus.label })) : null, projectSummaryStatus ? (_jsx(StatusPill, { tone: projectSummaryStatus.tone, children: projectSummaryStatus.label })) : null] }));
}
function LifecycleStatusPills({ lifecycle, }) {
    return (_jsxs(_Fragment, { children: [_jsx(StatusPill, { tone: lifecycle?.enabled ? 'good' : 'neutral', children: lifecycle?.enabled ? 'Enabled' : 'Disabled' }), _jsx(StatusPill, { tone: lifecycle?.trusted ? 'good' : 'warning', children: lifecycle?.trusted ? 'Trusted' : 'Untrusted' }), lifecycle?.updateAvailable ? (_jsx(StatusPill, { tone: "warning", children: OPENWAGGLE_EXTENSION.LIFECYCLE.UPDATE_AVAILABLE_LABEL })) : null] }));
}
function BuildStatusPill({ extensionPackage, }) {
    if (!extensionPackage.buildPlan?.approvalRequired) {
        return null;
    }
    if (extensionPackage.lifecycle?.buildStatus === OPENWAGGLE_EXTENSION.BUILD_RUN_STATUS.FAILED) {
        return _jsx(StatusPill, { tone: "error", children: OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_FAILED_LABEL });
    }
    const succeeded = isBuildPlanApproved(extensionPackage);
    return (_jsx(StatusPill, { tone: succeeded ? 'good' : 'warning', children: succeeded
            ? OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_SUCCEEDED_LABEL
            : OPENWAGGLE_EXTENSION.LIFECYCLE.BUILD_APPROVAL_REQUIRED_LABEL }));
}
function ReloadStatusPill({ lifecycle, }) {
    return match(lifecycle)
        .with(null, () => null)
        .with({ reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.SUCCEEDED }, () => (_jsx(StatusPill, { tone: "good", children: OPENWAGGLE_EXTENSION.LIFECYCLE.RELOAD_SUCCEEDED_LABEL })))
        .with({ reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.FAILED }, () => (_jsx(StatusPill, { tone: "error", children: OPENWAGGLE_EXTENSION.LIFECYCLE.RELOAD_FAILED_LABEL })))
        .with({
        enabled: true,
        reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED,
    }, () => (_jsx(StatusPill, { tone: "warning", children: OPENWAGGLE_EXTENSION.LIFECYCLE.RELOAD_REQUIRED_LABEL })))
        .with({ reloadStatus: OPENWAGGLE_EXTENSION.RELOAD_STATUS.NOT_RELOADED }, () => null)
        .exhaustive();
}
export function PackageStatusPills({ extensionPackage, }) {
    const lifecycle = extensionPackage.lifecycle;
    const sdkStatus = sdkStatusPill(extensionPackage);
    return (_jsxs(_Fragment, { children: [_jsx(StatusPill, { tone: "neutral", children: extensionPackage.scope.label }), _jsx(ProjectStatusPills, { extensionPackage: extensionPackage }), _jsx(LifecycleStatusPills, { lifecycle: lifecycle }), _jsx(BuildStatusPill, { extensionPackage: extensionPackage }), _jsx(ReloadStatusPill, { lifecycle: lifecycle }), _jsx(StatusPill, { tone: sdkStatus.tone, children: sdkStatus.label })] }));
}
export function PackageTrustIcon({ extensionPackage, }) {
    return extensionPackage.lifecycle?.trusted ? (_jsx(ShieldCheck, { className: "size-4 shrink-0 text-emerald-300" })) : (_jsx(AlertTriangle, { className: "size-4 shrink-0 text-amber-300" }));
}
