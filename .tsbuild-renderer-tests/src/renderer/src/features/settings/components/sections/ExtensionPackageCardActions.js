import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { Button } from '@/shared/ui/Button';
import { ReloadAction, RemoveAction } from './ExtensionPackageLifecycleActions';
import { ProjectOverrideActions } from './ExtensionProjectOverrideActions';
import { hasErrorDiagnostics, isBuildPlanApproved, isSdkCompatible, packageTitle, } from './extension-package-card-model';
function canEnablePackage(extensionPackage) {
    return (extensionPackage.projectOverride?.disabled !== true &&
        extensionPackage.lifecycle?.trusted === true &&
        extensionPackage.manifest !== null &&
        extensionPackage.contentHash !== null &&
        isSdkCompatible(extensionPackage) &&
        isBuildPlanApproved(extensionPackage) &&
        !hasErrorDiagnostics(extensionPackage));
}
function canApproveUpdate(extensionPackage) {
    return (extensionPackage.lifecycle?.updateAvailable === true &&
        extensionPackage.manifest !== null &&
        extensionPackage.contentHash !== null &&
        isSdkCompatible(extensionPackage) &&
        isBuildPlanApproved(extensionPackage) &&
        !hasErrorDiagnostics(extensionPackage));
}
function canApproveBuild(extensionPackage) {
    return (extensionPackage.buildPlan?.approvalRequired === true &&
        extensionPackage.buildPlan.approved === false &&
        extensionPackage.buildPlan.inputHash !== null);
}
function disabledEnableReason(extensionPackage) {
    if (extensionPackage.projectOverride?.disabled === true) {
        return 'Enable this extension for the project before changing package enablement.';
    }
    if (extensionPackage.lifecycle?.updateAvailable === true) {
        return 'Approve this extension update before enabling it.';
    }
    if (extensionPackage.lifecycle?.trusted !== true) {
        return 'Trust this extension before enabling it.';
    }
    if (!isBuildPlanApproved(extensionPackage)) {
        return 'Approve and run this extension build before enabling it.';
    }
    if (extensionPackage.manifest === null) {
        return 'Cannot enable an extension with an invalid manifest.';
    }
    if (extensionPackage.contentHash === null) {
        return 'Cannot enable an extension without a content hash.';
    }
    if (!isSdkCompatible(extensionPackage)) {
        return 'Cannot enable an extension with an incompatible SDK range.';
    }
    if (hasErrorDiagnostics(extensionPackage)) {
        return 'Cannot enable an extension with error diagnostics.';
    }
    return undefined;
}
function disabledUpdateReason(extensionPackage) {
    if (extensionPackage.manifest === null) {
        return 'Cannot approve an extension update with an invalid manifest.';
    }
    if (extensionPackage.contentHash === null) {
        return 'Cannot approve an extension update without a content hash.';
    }
    if (!isSdkCompatible(extensionPackage)) {
        return 'Cannot approve an extension update with an incompatible SDK range.';
    }
    if (!isBuildPlanApproved(extensionPackage)) {
        return 'Approve and run this extension build before approving the update.';
    }
    if (hasErrorDiagnostics(extensionPackage)) {
        return 'Cannot approve an extension update with error diagnostics.';
    }
    return undefined;
}
function disabledBuildReason(extensionPackage) {
    if (extensionPackage.buildPlan?.approvalRequired !== true) {
        return 'This extension does not require local build approval.';
    }
    if (extensionPackage.buildPlan.inputHash === null) {
        return 'Cannot approve the build plan until source files are valid.';
    }
    return undefined;
}
function trustActionLabel(trusted) {
    return trusted ? 'Untrust' : 'Trust';
}
function trustActionValue({ trusted, updateAvailable, }) {
    return updateAvailable ? false : !trusted;
}
function enableActionLabel(enabled) {
    return enabled ? 'Disable' : 'Enable';
}
function TrustAction({ extensionPackage, busy, trusted, updateAvailable, onSetTrusted, }) {
    const trustLabel = updateAvailable ? 'Untrust' : trustActionLabel(trusted);
    return (_jsx(Button, { size: "xs", variant: trusted || updateAvailable ? 'secondary' : 'accent', disabled: busy, onClick: () => onSetTrusted(trustActionValue({ trusted, updateAvailable })), "aria-label": `${trustLabel} ${packageTitle(extensionPackage)}`, children: busy ? 'Saving…' : trustLabel }));
}
function UpdateAction({ extensionPackage, busy, updateAvailable, onAcceptUpdate, }) {
    if (!updateAvailable) {
        return null;
    }
    const approveUpdateLabel = OPENWAGGLE_EXTENSION.LIFECYCLE.APPROVE_UPDATE_ACTION_LABEL;
    return (_jsx(Button, { size: "xs", variant: "accent", disabled: busy || !canApproveUpdate(extensionPackage), onClick: onAcceptUpdate, "aria-label": `${approveUpdateLabel} ${packageTitle(extensionPackage)}`, title: disabledUpdateReason(extensionPackage), children: busy ? 'Saving…' : approveUpdateLabel }));
}
function BuildApprovalAction({ extensionPackage, busy, onApproveBuild, }) {
    const visible = extensionPackage.buildPlan?.approvalRequired === true && !extensionPackage.buildPlan.approved;
    if (!visible) {
        return null;
    }
    const approveBuildLabel = OPENWAGGLE_EXTENSION.LIFECYCLE.APPROVE_BUILD_ACTION_LABEL;
    return (_jsx(Button, { size: "xs", variant: "accent", disabled: busy || !canApproveBuild(extensionPackage), onClick: onApproveBuild, "aria-label": `${approveBuildLabel} ${packageTitle(extensionPackage)}`, title: disabledBuildReason(extensionPackage), children: busy ? 'Saving…' : approveBuildLabel }));
}
function EnableAction({ extensionPackage, busy, enabled, onSetEnabled, }) {
    const enableAllowed = enabled || canEnablePackage(extensionPackage);
    const enableLabel = enableActionLabel(enabled);
    return (_jsx(Button, { size: "xs", variant: enabled ? 'secondary' : 'accent', disabled: busy || !enableAllowed, onClick: () => onSetEnabled(!enabled), "aria-label": `${enableLabel} ${packageTitle(extensionPackage)}`, title: enabled ? undefined : disabledEnableReason(extensionPackage), children: enableLabel }));
}
export function PackageActions({ extensionPackage, busy, projectLabel, actions, }) {
    const trusted = extensionPackage.lifecycle?.trusted === true;
    const enabled = extensionPackage.lifecycle?.enabled === true;
    const updateAvailable = extensionPackage.lifecycle?.updateAvailable === true;
    return (_jsxs("div", { className: "mt-4 flex flex-wrap gap-2", children: [_jsx(TrustAction, { extensionPackage: extensionPackage, busy: busy, trusted: trusted, updateAvailable: updateAvailable, onSetTrusted: actions.onSetTrusted }), _jsx(UpdateAction, { extensionPackage: extensionPackage, busy: busy, updateAvailable: updateAvailable, onAcceptUpdate: actions.onAcceptUpdate }), _jsx(BuildApprovalAction, { extensionPackage: extensionPackage, busy: busy, onApproveBuild: actions.onApproveBuild }), _jsx(EnableAction, { extensionPackage: extensionPackage, busy: busy, enabled: enabled, onSetEnabled: actions.onSetEnabled }), _jsx(ReloadAction, { extensionPackage: extensionPackage, busy: busy, enabled: enabled, onReload: actions.onReload }), _jsx(RemoveAction, { extensionPackage: extensionPackage, busy: busy, onRemove: actions.onRemove }), _jsx(ProjectOverrideActions, { extensionPackage: extensionPackage, busy: busy, projectLabel: projectLabel, onSetProjectDisabled: actions.onSetProjectDisabled })] }));
}
