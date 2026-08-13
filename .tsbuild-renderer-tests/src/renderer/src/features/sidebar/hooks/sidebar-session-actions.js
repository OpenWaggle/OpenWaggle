import { SessionNodeId } from '@shared/types/brand';
import { useChatStore } from '@/features/chat/state';
import { buildComposerDraftContextKey, setEditorText } from '@/features/composer/lib';
import { useComposerStore } from '@/features/composer/state';
import { api } from '@/shared/lib/ipc';
import { clearComposerDraftForSession, errorMessage } from './sidebar-action-utils';
function navigateHomeAfterActiveSessionChange(deps, sessionId) {
    if (deps.activeSessionId !== sessionId)
        return;
    deps.startDraftSession(deps.projectPath);
    void deps.navigate({ to: '/' });
}
function setComposerTextValue(text) {
    const composer = useComposerStore.getState();
    composer.setInput(text);
    composer.setCursorIndex(text.length);
    if (composer.lexicalEditor)
        setEditorText(composer.lexicalEditor, text);
}
function activateClonedSession(deps, sessionId, project) {
    const contextKey = buildComposerDraftContextKey({ projectPath: project, sessionId });
    useComposerStore.getState().switchScopedDraftContext(contextKey, { input: '', attachments: [] });
    setComposerTextValue('');
    useChatStore.getState().setActiveSession(sessionId);
    void deps.navigate({ to: '/sessions/$sessionId', params: { sessionId: String(sessionId) } });
}
function cloneSession(deps, sessionId) {
    const targetNodeId = deps.matchingActiveWorkspace?.activeNodeId ??
        deps.matchingActiveSessionTree?.session.lastActiveNodeId;
    if (deps.activeSessionId !== sessionId) {
        deps.showToast('Open this session before cloning it.');
        return;
    }
    if (!targetNodeId) {
        deps.showToast('No session history to clone.');
        return;
    }
    void api
        .cloneSessionToNew(sessionId, deps.selectedModel, SessionNodeId(String(targetNodeId)))
        .then((result) => {
        if (result.cancelled) {
            deps.showToast('Session clone cancelled.');
            return;
        }
        if (!result.session) {
            deps.showToast('Session clone did not return a session.');
            return;
        }
        useChatStore.getState().upsertSession(result.session);
        activateClonedSession(deps, result.session.id, result.session.projectPath);
        return Promise.all([
            deps.loadChatSessions(),
            deps.loadSessionTrees(),
            deps.refreshSessionWorkspace(result.session.id),
        ]);
    })
        .catch((error) => {
        deps.showToast(`Failed to clone session: ${errorMessage(error)}`);
    });
}
export function createSidebarSessionActions(deps) {
    return {
        archive(sessionId) {
            void (async () => {
                const confirmed = await api.showConfirm('Archive this session?', 'Archiving hides the full session and all branches from normal navigation.');
                if (!confirmed)
                    return;
                await api.archiveSession(sessionId);
                clearComposerDraftForSession(sessionId);
                await Promise.all([deps.loadChatSessions(), deps.loadSessionTrees()]);
                navigateHomeAfterActiveSessionChange(deps, sessionId);
            })().catch((error) => {
                deps.showToast(`Failed to archive session: ${errorMessage(error)}`);
            });
        },
        clone(sessionId) {
            cloneSession(deps, sessionId);
        },
        delete(sessionId) {
            void deps
                .deleteSession(sessionId)
                .then(() => navigateHomeAfterActiveSessionChange(deps, sessionId))
                .catch((error) => {
                deps.showToast(`Failed to delete session: ${errorMessage(error)}`);
            });
        },
        select(id) {
            deps.clearTransientDraftContext();
            useChatStore.getState().setActiveSession(id);
            void deps.navigate({ to: '/sessions/$sessionId', params: { sessionId: String(id) } });
        },
    };
}
