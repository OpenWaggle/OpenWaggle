import { api } from '@/shared/lib/ipc';
import { clearComposerDraftsForSessions, errorMessage } from './sidebar-action-utils';
function projectSessionsForPath(sessions, archivedSessions, path) {
    const byId = new Map();
    for (const session of sessions) {
        if (session.projectPath === path)
            byId.set(String(session.id), session);
    }
    for (const session of archivedSessions) {
        if (session.projectPath === path)
            byId.set(String(session.id), session);
    }
    return [...byId.values()];
}
function resetToDraftForProject(deps, projectPath) {
    deps.clearTransientDraftContext();
    deps.startDraftSession(projectPath);
    if (projectPath)
        deps.expandProject(projectPath);
    void deps.navigate({ to: '/' });
}
async function selectProjectPath(deps, path) {
    resetToDraftForProject(deps, path);
    await deps.setProjectPath(path);
    deps.refreshGit(path);
}
async function archiveProjectSessions(deps, path, projectSessions) {
    const sessionCount = projectSessions.length;
    if (sessionCount === 0)
        return;
    const confirmed = await api.showConfirm(`Archive ${sessionCount} session${sessionCount === 1 ? '' : 's'} in ${deps.displayProjectName(path)}?`, `Project: ${path}`);
    if (!confirmed)
        return;
    await Promise.all(projectSessions.map((session) => api.archiveSession(session.id)));
    clearComposerDraftsForSessions(projectSessions);
    await Promise.all([deps.loadChatSessions(), deps.loadSessionTrees()]);
    const archivedActiveSession = deps.activeSessionId !== null &&
        projectSessions.some((session) => String(session.id) === deps.activeSessionId);
    if (archivedActiveSession)
        resetToDraftForProject(deps, deps.projectPath);
}
async function removeProject(deps, path) {
    const archivedSessions = await api.listArchivedSessions();
    const projectSessions = projectSessionsForPath(deps.sessions, archivedSessions, path);
    const sessionCount = projectSessions.length;
    const confirmed = await api.showConfirm(`Remove ${deps.displayProjectName(path)} and permanently delete ${sessionCount} session${sessionCount === 1 ? '' : 's'}?`, `Project: ${path}\nThis cannot be undone.`);
    if (!confirmed)
        return;
    const projectSessionIds = new Set(projectSessions.map((session) => String(session.id)));
    const activeRuns = await api.listActiveRuns();
    await Promise.all(activeRuns.flatMap((run) => projectSessionIds.has(String(run.sessionId)) ? [api.cancelAgent(run.sessionId)] : []));
    await Promise.all(projectSessions.map((session) => api.deleteSession(session.id)));
    clearComposerDraftsForSessions(projectSessions);
    await deps.removeProjectReferences(path);
    await Promise.all([deps.loadChatSessions(), deps.loadSessionTrees()]);
    if (projectSessionIds.has(String(deps.activeSessionId)) || deps.projectPath === path) {
        deps.startDraftSession(null);
        deps.refreshGit(null);
        void deps.navigate({ to: '/' });
    }
}
export function createSidebarProjectActions(deps) {
    return {
        archiveSessions(path, projectSessions) {
            void archiveProjectSessions(deps, path, projectSessions).catch((error) => {
                deps.showToast(`Failed to archive project sessions: ${errorMessage(error)}`);
            });
        },
        async openProject() {
            const path = await deps.selectFolder();
            if (!path)
                return;
            try {
                await selectProjectPath(deps, path);
            }
            catch (error) {
                deps.showToast(`Failed to select project: ${errorMessage(error)}`);
            }
        },
        openInFinder(path) {
            void api.openPath(path).catch((error) => {
                deps.showToast(`Failed to open project folder: ${errorMessage(error)}`);
            });
        },
        remove(path) {
            void removeProject(deps, path).catch((error) => {
                deps.showToast(`Failed to remove project: ${errorMessage(error)}`);
            });
        },
        rename(path, name) {
            void deps.setProjectDisplayName(path, name).catch((error) => {
                deps.showToast(`Failed to rename project: ${errorMessage(error)}`);
            });
        },
        async selectProjectPath(path) {
            try {
                await selectProjectPath(deps, path);
            }
            catch (error) {
                deps.showToast(`Failed to select project: ${errorMessage(error)}`);
            }
        },
    };
}
