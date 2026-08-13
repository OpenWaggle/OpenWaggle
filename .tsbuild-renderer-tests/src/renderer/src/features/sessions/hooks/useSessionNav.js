import { useSessionStatusStore } from '@/features/sessions/state/session-status-store';
/** Pure factory — testable without React. */
export function createSessionNavHandlers(deps) {
    const { sessions, projectPath, setActiveView, setProjectPath, selectFolder, startDraftSession, setActiveSession, refreshGitStatus, refreshGitBranches, } = deps;
    function refreshGit(path) {
        void Promise.all([refreshGitStatus(path), refreshGitBranches(path)]);
    }
    async function handleSelectSession(id) {
        setActiveView('chat');
        const session = sessions.find((c) => c.id === id);
        const nextProjectPath = session?.projectPath ?? projectPath;
        setActiveSession(id);
        useSessionStatusStore.getState().markVisited(id);
        if (session && session.projectPath !== projectPath) {
            await setProjectPath(session.projectPath);
        }
        refreshGit(nextProjectPath);
    }
    function handleNewSession() {
        setActiveView('chat');
        startDraftSession(projectPath);
    }
    async function handleOpenProject() {
        setActiveView('chat');
        const path = await selectFolder();
        if (!path)
            return;
        startDraftSession(path);
        await setProjectPath(path);
        refreshGit(path);
    }
    async function handleSelectProjectPath(path) {
        setActiveView('chat');
        startDraftSession(path);
        await setProjectPath(path);
        refreshGit(path);
    }
    return {
        handleSelectSession,
        handleNewSession,
        handleOpenProject,
        handleSelectProjectPath,
    };
}
/** Hook wrapper — calls the factory with current deps. */
export function useSessionNav(deps) {
    return createSessionNavHandlers(deps);
}
