import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { Button } from '@/shared/ui/Button';
import { packageTitle } from './extension-package-card-model';
function projectActionLabel(projectDisabled) {
    return projectDisabled
        ? OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.ENABLE_ACTION_LABEL
        : OPENWAGGLE_EXTENSION.PROJECT_OVERRIDE.DISABLE_ACTION_LABEL;
}
function ProjectOverrideAction({ extensionPackage, busy, onSetProjectDisabled, }) {
    const projectOverride = extensionPackage.projectOverride;
    if (!projectOverride) {
        return null;
    }
    const projectDisabled = projectOverride.disabled;
    const label = projectActionLabel(projectDisabled);
    return (_jsx(Button, { size: "xs", variant: projectDisabled ? 'accent' : 'secondary', disabled: busy, onClick: () => onSetProjectDisabled(projectOverride.projectPath, !projectDisabled), "aria-label": `${label} ${packageTitle(extensionPackage)}`, children: busy ? 'Saving…' : label }));
}
function ProjectOverrideAvailability({ extensionPackage, busy, projectLabel, onSetProjectDisabled, }) {
    const projectOverrides = extensionPackage.projectOverrides;
    if (extensionPackage.scope.kind !== OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND ||
        projectOverrides.length <= 1) {
        return null;
    }
    return (_jsxs("div", { className: "mt-3 basis-full rounded-md border border-border/70 bg-bg-secondary/40 p-2", children: [_jsx("div", { className: "mb-2 text-[11px] font-medium text-text-tertiary", children: "Project availability" }), _jsx("div", { className: "flex flex-wrap gap-2", children: projectOverrides.map((projectOverride) => {
                    const projectDisabled = projectOverride.disabled;
                    const label = projectActionLabel(projectDisabled);
                    const projectName = projectLabel(projectOverride.projectPath);
                    return (_jsxs(Button, { size: "xs", variant: projectDisabled ? 'accent' : 'secondary', disabled: busy, onClick: () => onSetProjectDisabled(projectOverride.projectPath, !projectDisabled), "aria-label": `${label} ${packageTitle(extensionPackage)} for ${projectName}`, children: [projectName, ": ", busy ? 'Saving…' : label] }, projectOverride.projectPath));
                }) })] }));
}
export function ProjectOverrideActions({ extensionPackage, busy, projectLabel, onSetProjectDisabled, }) {
    return (_jsxs(_Fragment, { children: [_jsx(ProjectOverrideAction, { extensionPackage: extensionPackage, busy: busy, onSetProjectDisabled: onSetProjectDisabled }), _jsx(ProjectOverrideAvailability, { extensionPackage: extensionPackage, busy: busy, projectLabel: projectLabel, onSetProjectDisabled: onSetProjectDisabled })] }));
}
