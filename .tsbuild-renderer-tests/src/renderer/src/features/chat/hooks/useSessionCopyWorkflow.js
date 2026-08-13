import { SessionNodeId } from '@shared/types/brand';
import { useState } from 'react';
import { useChatStore } from '@/features/chat/state';
import { buildComposerDraftContextKey } from '@/features/composer/lib';
import { useComposerStore } from '@/features/composer/state';
import { api } from '@/shared/lib/ipc';
import { setComposerTextValue } from '../lib/composer-text';
import { getVisibleForkTargets } from '../lib/session-fork-targets';
function copyErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
function routeToCopiedSession(params, sessionId) {
    void params.navigate({
        to: '/sessions/$sessionId',
        params: { sessionId: String(sessionId) },
        search: (previous) => ({ ...previous, branch: undefined, node: undefined }),
    });
}
async function activateCopiedSession(params, sessionId, editorText) {
    const session = useChatStore.getState().sessionById.get(sessionId);
    const contextKey = buildComposerDraftContextKey({
        projectPath: session?.projectPath ?? params.projectPath,
        sessionId,
    });
    const appliedDraft = useComposerStore.getState().switchScopedDraftContext(contextKey, {
        input: editorText,
        attachments: [],
    });
    setComposerTextValue(appliedDraft.input);
    params.setActiveSession(sessionId);
    routeToCopiedSession(params, sessionId);
    await Promise.all([
        params.loadSessions(),
        params.refreshSession(sessionId),
        params.refreshSessionWorkspace(sessionId),
    ]);
}
async function forkMessageToNewSessionAction(params, messageId) {
    if (!params.activeSessionId)
        return;
    try {
        const result = await api.forkSessionToNew(params.activeSessionId, params.model, SessionNodeId(messageId));
        if (result.cancelled) {
            params.showToast('Session fork cancelled.');
            return;
        }
        if (!result.session) {
            params.showToast('Session fork did not return a session.');
            return;
        }
        useChatStore.getState().upsertSession(result.session);
        await activateCopiedSession(params, result.session.id, result.editorText ?? '');
    }
    catch (error) {
        params.showToast(`Failed to fork session: ${copyErrorMessage(error)}`);
    }
}
async function cloneCurrentSessionToNewSessionAction(params) {
    if (!params.activeSessionId) {
        params.showToast('No active session to clone.');
        return;
    }
    const targetNodeId = params.draftBranchSourceNodeId ?? params.activeWorkspace?.activeNodeId;
    if (!targetNodeId) {
        params.showToast('No session history to clone.');
        return;
    }
    try {
        const result = await api.cloneSessionToNew(params.activeSessionId, params.model, SessionNodeId(String(targetNodeId)));
        if (result.cancelled) {
            params.showToast('Session clone cancelled.');
            return;
        }
        if (!result.session) {
            params.showToast('Session clone did not return a session.');
            return;
        }
        useChatStore.getState().upsertSession(result.session);
        await activateCopiedSession(params, result.session.id, '');
    }
    catch (error) {
        params.showToast(`Failed to clone session: ${copyErrorMessage(error)}`);
    }
}
export function useSessionCopyWorkflow(params) {
    const [forkSelectorOpen, setForkSelectorOpen] = useState(false);
    const forkTargets = getVisibleForkTargets(params.activeWorkspace);
    return {
        forkSelectorOpen,
        forkTargets,
        closeForkSelector() {
            setForkSelectorOpen(false);
        },
        cloneCurrentSessionToNewSession() {
            return cloneCurrentSessionToNewSessionAction(params);
        },
        forkMessageToNewSession(messageId) {
            return forkMessageToNewSessionAction(params, messageId);
        },
        openForkSelector() {
            if (forkTargets.length === 0) {
                params.showToast('No user messages are available to fork.');
                return;
            }
            setForkSelectorOpen(true);
        },
        selectForkTarget(target) {
            setForkSelectorOpen(false);
            void forkMessageToNewSessionAction(params, String(target.entryId));
        },
    };
}
