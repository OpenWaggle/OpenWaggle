import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { matchBy } from '@diegogbrisa/ts-match';
import { ExtensionAgentLoopSurface } from '@/features/extensions';
import { cn } from '@/shared/lib/cn';
import { useChatScrollBehaviour } from '../hooks/useChatScrollBehaviour';
import { ChatRowRenderer } from './ChatRowRenderer';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { WelcomeScreen } from './WelcomeScreen';
const PADDING_TOP = 20;
function getChatRowKey(row) {
    return matchBy(row, 'type')
        .with('message', (value) => `message:${value.message.id}`)
        .with('waggle-turn', (value) => value.id)
        .with('interrupted-run', (value) => `interrupted-run:${value.runId}`)
        .with('agent-loop-custom-message', (value) => `custom:${value.event.timestamp}:${value.event.name}`)
        .with('agent-loop-interaction-event', (value) => value.event.type === 'agent_interaction_request'
        ? `interaction-request:${value.event.interaction.interactionId}`
        : `interaction-resolved:${value.event.interactionId}`)
        .with('branch-summary', (value) => `branch-summary:${value.id}`)
        .with('compaction-summary', (value) => `compaction:${value.id}`)
        .with('phase-indicator', (value) => `phase:${value.label}`)
        .with('run-summary', (value) => `run-summary:${String(value.totalMs)}`)
        .with('error', (value) => `error:${value.sessionId ?? 'none'}:${value.error.message}`)
        .exhaustive();
}
function TranscriptRows({ rows, context, }) {
    return (_jsx(_Fragment, { children: rows.map((row, index) => {
            const isUserMessage = row.type === 'message' && row.message.role === 'user';
            return (_jsx("div", { className: "mx-auto w-full max-w-[720px] px-12 pb-6", ...(isUserMessage ? { 'data-user-message-id': row.message.id } : {}), style: index === 0 ? { paddingTop: PADDING_TOP } : undefined, children: _jsx(ChatRowRenderer, { row: row, context: context }) }, getChatRowKey(row)));
        }) }));
}
function TranscriptExtensionCards({ activeSessionId, extensionRegistry, extensionProjectPaths, rowsLength, }) {
    return (_jsx("div", { className: "mx-auto w-full max-w-[720px] px-12 pb-6", children: _jsx(ExtensionAgentLoopSurface, { fallback: null, input: {
                surface: 'transcript',
                transcript: {
                    sessionId: activeSessionId ? String(activeSessionId) : null,
                    projectPaths: extensionProjectPaths,
                    messageCount: rowsLength,
                    state: rowsLength > 0 ? 'active' : 'empty',
                },
            }, projectPaths: extensionProjectPaths, registry: extensionRegistry }) }));
}
export function ChatTranscript({ section }) {
    const { messages, isLoading, projectPath, recentProjects, activeSessionId, chatRows: rows, onOpenProject, onSelectProjectPath, onRetryText, onOpenSettings, onDismissError, onDismissInterruptedRun, onBranchFromMessage, onForkFromMessage, onViewTurnDiff, turnAnchorMessageIds, lastUserMessageId, streamSignalVersion, userDidSend, onUserDidSendConsumed, extensionRegistry, extensionProjectPaths, } = section;
    const { scrollerRef, contentRef, showScrollbar, showScrollToBottom, scrollToBottom, handleScroll, handleWheel, handlePointerDown, handlePointerUp, handlePointerCancel, handleTouchStart, handleTouchMove, handleTouchEnd, } = useChatScrollBehaviour({
        activeSessionId: activeSessionId ?? null,
        lastUserMessageId,
        rowsLength: rows.length,
        streamVersion: streamSignalVersion,
        isLoading,
        userDidSend,
        onUserDidSendConsumed,
    });
    const rowContext = {
        runtime: {
            sessionId: activeSessionId,
            extensions: { registry: extensionRegistry, projectPaths: extensionProjectPaths },
        },
        extensions: { registry: extensionRegistry, projectPaths: extensionProjectPaths },
        actions: { onBranchFromMessage, onForkFromMessage, onViewTurnDiff, turnAnchorMessageIds },
        onOpenSettings,
        onRetry: (content) => {
            void onRetryText(content);
        },
        onDismissError,
        onDismissInterruptedRun,
    };
    if (messages.length === 0 && rows.length === 0 && !isLoading) {
        return (_jsx("div", { className: "flex-1 overflow-y-auto chat-scroll", children: _jsx(WelcomeScreen, { projectPath: projectPath, hasProject: !!projectPath, recentProjects: recentProjects, onOpenProject: () => {
                    void onOpenProject();
                }, onSelectProjectPath: onSelectProjectPath, onRetry: projectPath
                    ? (content) => {
                        void onRetryText(content);
                    }
                    : undefined }) }));
    }
    const scrollerProps = {
        role: 'log',
        'aria-label': 'Chat messages',
        'aria-busy': isLoading,
        className: cn('flex flex-1 flex-col overflow-y-auto chat-scroll [overflow-anchor:none]', showScrollbar && 'is-scrolling'),
        onScroll: handleScroll,
        onWheel: handleWheel,
        onPointerDown: handlePointerDown,
        onPointerUp: handlePointerUp,
        onPointerCancel: handlePointerCancel,
        onTouchStart: handleTouchStart,
        onTouchMove: handleTouchMove,
        onTouchEnd: handleTouchEnd,
        onTouchCancel: handleTouchEnd,
    };
    return (_jsxs("div", { className: "relative flex flex-1 flex-col overflow-hidden", children: [_jsx("div", { ref: scrollerRef, ...scrollerProps, children: _jsxs("div", { ref: contentRef, className: "flex min-h-full flex-col", children: [_jsx(TranscriptRows, { rows: rows, context: rowContext }), _jsx(TranscriptExtensionCards, { activeSessionId: activeSessionId, extensionRegistry: extensionRegistry, extensionProjectPaths: extensionProjectPaths, rowsLength: rows.length })] }) }), _jsx(ScrollToBottomButton, { visible: showScrollToBottom, onClick: scrollToBottom })] }));
}
