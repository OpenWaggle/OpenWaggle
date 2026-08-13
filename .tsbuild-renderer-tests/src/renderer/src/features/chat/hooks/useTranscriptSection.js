import { useState } from 'react';
import { useWaggleMetadataLookup } from '@/features/chat/hooks/useWaggleMetadataLookup';
import { useSessionStore } from '@/features/sessions/state';
import { mergeCustomMessages, mergeInteractionEvents, readAgentLoopEventsFromWorkspace, } from '../lib/agent-loop-transcript-events';
import { resolveTranscriptMessages } from '../lib/session-workspace-transcript';
import { useChatRows } from './useChatRows';
function resolveLastUserMessage(messages) {
    let lastUserMessage;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message && message.role === 'user') {
            lastUserMessage = message;
            break;
        }
    }
    if (!lastUserMessage) {
        return null;
    }
    const content = lastUserMessage.parts
        .flatMap((part) => (part.type === 'text' ? [part.content] : []))
        .join('\n');
    return content || null;
}
export function useTranscriptSection(params) {
    const { messages, customMessages, interactionEvents, isLoading, isSteering, error, streamSignalVersion, projectPath, recentProjects, activeSessionId, activeSession, model, phase, extensionRegistry, extensionProjectPaths, handleOpenProject, handleSelectProjectPath, handleSendText, openSettings, handleDismissInterruptedRun, handleBranchFromMessage, handleForkFromMessage, userDidSend, onUserDidSendConsumed, } = params;
    const [dismissedError, setDismissedError] = useState(null);
    const activeWorkspace = useSessionStore((state) => state.activeWorkspace);
    const draftBranch = useSessionStore((state) => state.draftBranch);
    const draftBranchSourceNodeId = activeSessionId &&
        draftBranch?.sessionId &&
        String(draftBranch.sessionId) === String(activeSessionId)
        ? draftBranch.sourceNodeId
        : null;
    const transcriptLoading = isLoading || isSteering;
    const transcriptMessages = resolveTranscriptMessages({
        activeSessionId,
        activeWorkspace,
        messages,
        draftBranchSourceNodeId,
    });
    const persistedAgentLoopEvents = activeWorkspace
        ? readAgentLoopEventsFromWorkspace(activeWorkspace)
        : { customMessages: [], interactionEvents: [] };
    const mergedCustomMessages = mergeCustomMessages(persistedAgentLoopEvents.customMessages, customMessages);
    const mergedInteractionEvents = mergeInteractionEvents(persistedAgentLoopEvents.interactionEvents, interactionEvents);
    const waggleMetadataLookup = useWaggleMetadataLookup(activeSession, transcriptMessages);
    const lastUserMessage = resolveLastUserMessage(transcriptMessages);
    const interruptedRun = activeWorkspace?.tree.session.id === activeSessionId
        ? activeWorkspace.tree.branches.find((branch) => branch.id === activeWorkspace.activeBranchId)
            ?.interruptedRun
        : undefined;
    const chatRows = useChatRows({
        messages: transcriptMessages,
        customMessages: mergedCustomMessages,
        interactionEvents: mergedInteractionEvents,
        isLoading: transcriptLoading,
        error,
        lastUserMessage,
        dismissedError,
        sessionId: activeSessionId,
        model,
        waggleMetadataLookup,
        phase,
        interruptedRun,
    });
    // Compute lastUserMessageId for session-restore identity gating, not send anchoring.
    const lastUserMessageId = (() => {
        for (let i = transcriptMessages.length - 1; i >= 0; i -= 1) {
            if (transcriptMessages[i]?.role === 'user')
                return transcriptMessages[i]?.id ?? null;
        }
        return null;
    })();
    return {
        messages: transcriptMessages,
        isLoading: transcriptLoading,
        projectPath,
        recentProjects,
        activeSessionId,
        chatRows,
        extensionRegistry,
        extensionProjectPaths,
        onOpenProject: handleOpenProject,
        onSelectProjectPath: handleSelectProjectPath,
        onRetryText: handleSendText,
        onOpenSettings: openSettings,
        onDismissError: setDismissedError,
        onDismissInterruptedRun: handleDismissInterruptedRun,
        onBranchFromMessage: handleBranchFromMessage,
        onForkFromMessage: handleForkFromMessage,
        onViewTurnDiff: params.handleViewTurnDiff,
        turnAnchorMessageIds: params.turnAnchorMessageIds,
        lastUserMessageId,
        streamSignalVersion,
        userDidSend,
        onUserDidSendConsumed,
    };
}
