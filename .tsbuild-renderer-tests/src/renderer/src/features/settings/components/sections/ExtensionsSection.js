import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions';
import { useSessions } from '@/features/sessions/hooks';
import { useExtensionsSectionController } from '@/features/settings/hooks/useExtensionsSectionController';
import { usePreferences } from '@/features/settings/hooks/useSettings';
import { projectName } from '@/shared/lib/format';
import { ExtensionContributionSummary } from './ExtensionContributionSummary';
import { ExtensionDiagnostics } from './ExtensionDiagnostics';
import { ExtensionPackageCard } from './ExtensionPackageCard';
import { ExtensionsErrorAlert, ExtensionsSectionHeading } from './ExtensionsSectionPanels';
import { summarizePackageContributions, } from './extension-contribution-summary-model';
import { SettingsContributionHost } from './SettingsContributionHost';
function packageActions(extensionPackage, handlers) {
    return {
        onSetTrusted: (trusted) => handlers.setTrusted(extensionPackage, trusted),
        onSetEnabled: (enabled) => handlers.setEnabled(extensionPackage, enabled),
        onSetProjectDisabled: (projectPath, disabled) => handlers.setProjectDisabled(extensionPackage, projectPath, disabled),
        onAcceptUpdate: () => handlers.acceptUpdate(extensionPackage),
        onApproveBuild: () => handlers.approveBuild(extensionPackage),
        onReload: () => handlers.reload(extensionPackage),
        onRemove: () => handlers.remove(extensionPackage),
    };
}
function addProjectPath(projectPaths, projectPath) {
    const trimmed = projectPath?.trim();
    if (trimmed && !projectPaths.includes(trimmed)) {
        projectPaths.push(trimmed);
    }
}
function buildProjectPaths({ selectedProjectPath, recentProjects, sessionProjectPaths, }) {
    const projectPaths = [];
    addProjectPath(projectPaths, selectedProjectPath);
    for (const projectPath of recentProjects) {
        addProjectPath(projectPaths, projectPath);
    }
    for (const projectPath of sessionProjectPaths) {
        addProjectPath(projectPaths, projectPath);
    }
    return projectPaths;
}
function packageKey(extensionPackage) {
    const scopeId = extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND
        ? extensionPackage.scope.projectPath
        : OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_ID;
    return `${extensionPackage.scope.kind}:${scopeId}:${extensionPackage.id}`;
}
function packagesForProject(packages, projectPath) {
    return packages.filter((extensionPackage) => extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
        extensionPackage.scope.projectPath === projectPath);
}
function packageContributionSummary(registry, extensionPackage) {
    if (!registry) {
        return null;
    }
    const entries = registry.entries.filter((entry) => entry.extensionId === extensionPackage.id &&
        entry.packagePath === extensionPackage.packagePath);
    return entries.length > 0 ? summarizePackageContributions(entries) : null;
}
function buildScopeGroups({ packages, projectPaths, projectLabel, }) {
    const globalPackages = packages.filter((extensionPackage) => extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND);
    const projectGroups = projectPaths.map((projectPath) => ({
        key: `project:${projectPath}`,
        title: projectLabel(projectPath),
        subtitle: projectPath,
        packages: packagesForProject(packages, projectPath),
    }));
    return [
        {
            key: 'global',
            title: 'Global scope',
            subtitle: 'Available to every project unless a project opts out.',
            packages: globalPackages,
        },
        ...projectGroups,
    ];
}
function ExtensionScopeSection({ group, contributionRegistry, busyExtensionId, projectLabel, handlers, }) {
    return (_jsxs("section", { className: "space-y-3 rounded-xl border border-border bg-bg-secondary/30 p-3", children: [_jsxs("div", { children: [_jsx("h3", { className: "text-[13px] font-semibold text-text-secondary", children: group.title }), _jsx("p", { className: "mt-0.5 text-[11px] text-text-muted", children: group.subtitle })] }), group.packages.length > 0 ? (_jsx("div", { className: "space-y-3", children: group.packages.map((extensionPackage) => (_jsx(ExtensionPackageCard, { extensionPackage: extensionPackage, contributionSummary: packageContributionSummary(contributionRegistry, extensionPackage), busy: busyExtensionId === extensionPackage.id, projectLabel: projectLabel, actions: packageActions(extensionPackage, handlers) }, packageKey(extensionPackage)))) })) : (_jsx("p", { className: "rounded-lg border border-border/70 bg-[#111418] p-4 text-[13px] text-text-muted", children: "No extension packages in this scope." }))] }));
}
function ContributionRegistryDiagnostics({ registry, }) {
    const diagnostics = registry?.diagnostics ?? [];
    if (diagnostics.length === 0) {
        return null;
    }
    return (_jsxs("section", { "aria-label": "Extension contribution registry diagnostics", className: "rounded-xl border border-border bg-bg-secondary/30 p-3", children: [_jsx("h3", { className: "text-[13px] font-semibold text-text-secondary", children: "Contribution registry diagnostics" }), _jsx("p", { className: "mt-0.5 text-[11px] text-text-muted", children: "Some extension contributions could not be registered." }), _jsx(ExtensionDiagnostics, { diagnostics: diagnostics })] }));
}
export function ExtensionsSection() {
    const { settings } = usePreferences();
    const { sessions } = useSessions();
    const requestedProjectPaths = buildProjectPaths({
        selectedProjectPath: settings.projectPath,
        recentProjects: settings.recentProjects,
        sessionProjectPaths: sessions.map((session) => session.projectPath),
    });
    function projectLabel(projectPath) {
        return settings.projectDisplayNames[projectPath]?.trim() || projectName(projectPath);
    }
    const { view, contributionRegistry, loading, updatingExtensionId, error, refresh, setTrusted, setEnabled, setProjectDisabled, acceptUpdate, approveBuild, reload, remove, } = useExtensionsSectionController(requestedProjectPaths);
    const packages = view?.packages ?? [];
    const projectPaths = view?.projectPaths ?? requestedProjectPaths;
    const scopeGroups = buildScopeGroups({ packages, projectPaths, projectLabel });
    const hasUnrecoveredError = error !== null && view === null;
    const handlers = {
        setTrusted: (extensionPackage, trusted) => void setTrusted(extensionPackage, trusted),
        setEnabled: (extensionPackage, enabled) => void setEnabled(extensionPackage, enabled),
        setProjectDisabled: (extensionPackage, projectPath, disabled) => void setProjectDisabled(extensionPackage, projectPath, disabled),
        acceptUpdate: (extensionPackage) => void acceptUpdate(extensionPackage),
        approveBuild: (extensionPackage) => void approveBuild(extensionPackage),
        reload: (extensionPackage) => void reload(extensionPackage),
        remove: (extensionPackage) => void remove(extensionPackage),
    };
    return (_jsxs("div", { className: "space-y-6", children: [_jsx(ExtensionsSectionHeading, { projectCount: projectPaths.length, loading: loading, onRefresh: () => void refresh() }), _jsx(ExtensionsErrorAlert, { message: error }), view ? (_jsx(ExtensionContributionSummary, { registry: contributionRegistry, packages: packages })) : null, _jsx(ContributionRegistryDiagnostics, { registry: contributionRegistry }), _jsx(SettingsContributionHost, { registry: contributionRegistry }), loading && !view ? (_jsx("p", { className: "rounded-lg border border-border bg-[#111418] px-4 py-6 text-[13px] text-text-muted", children: "Loading extensions\u2026" })) : hasUnrecoveredError ? null : scopeGroups.length > 0 ? (_jsx("div", { className: "space-y-3", children: scopeGroups.map((group) => (_jsx(ExtensionScopeSection, { group: group, contributionRegistry: contributionRegistry, busyExtensionId: updatingExtensionId, projectLabel: projectLabel, handlers: handlers }, group.key))) })) : (_jsx("p", { className: "rounded-lg border border-border bg-[#111418] px-4 py-6 text-[13px] text-text-muted", children: "No extension packages discovered." }))] }));
}
