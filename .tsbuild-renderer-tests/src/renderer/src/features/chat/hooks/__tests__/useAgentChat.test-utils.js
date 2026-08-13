import { MessageId, SessionId, ToolCallId } from '@shared/types/brand';
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { useOptimisticUserMessageStore } from '../../state/optimistic-user-message-store';
const { apiMock, getRunRenderSnapshotMock, hasActiveRunMock, runRenderSnapshots, setRunRenderMessagesMock, useBackgroundRunStoreMock, upsertSessionMock, useChatStoreMock, agentEventHandlers, runCompletedHandlers, } = vi.hoisted(() => {
    const agentEventHandlers = [];
    const runCompletedHandlers = [];
    const runRenderSnapshots = new Map();
    const getRunRenderSnapshotMock = vi.fn((sessionId) => runRenderSnapshots.get(String(sessionId)) ?? null);
    const setRunRenderMessagesMock = vi.fn((sessionId, messages) => {
        runRenderSnapshots.set(String(sessionId), {
            messages: [...messages],
            updatedAt: Date.now(),
        });
    });
    const hasActiveRunMock = vi.fn(() => false);
    const useBackgroundRunStoreMock = vi.fn((selector) => selector({
        getRunRenderSnapshot: getRunRenderSnapshotMock,
        hasActiveRun: hasActiveRunMock,
        setRunRenderMessages: setRunRenderMessagesMock,
    }));
    const upsertSessionMock = vi.fn();
    const useChatStoreMock = vi.fn((selector) => selector({ upsertSession: upsertSessionMock }));
    return {
        apiMock: {
            onAgentEvent: vi.fn((handler) => {
                agentEventHandlers.push(handler);
                return () => { };
            }),
            onRunCompleted: vi.fn((handler) => {
                runCompletedHandlers.push(handler);
                return () => { };
            }),
            getBackgroundRun: vi.fn(async () => null),
            getSessionDetail: vi.fn(async () => null),
            sendMessage: vi.fn(async () => undefined),
            sendWaggleMessage: vi.fn(async () => undefined),
            cancelAgent: vi.fn(async () => undefined),
            steerAgent: vi.fn(async () => ({ preserved: true })),
            respondAgentInteraction: vi.fn(async () => ({
                ok: true,
                interactionId: 'interaction-1',
                status: 'resolved',
            })),
        },
        runRenderSnapshots,
        getRunRenderSnapshotMock,
        setRunRenderMessagesMock,
        hasActiveRunMock,
        useBackgroundRunStoreMock,
        upsertSessionMock,
        useChatStoreMock,
        agentEventHandlers,
        runCompletedHandlers,
    };
});
vi.mock('@/shared/lib/ipc', () => ({
    api: apiMock,
}));
vi.mock('@/features/chat/state/background-run-store', () => ({
    useBackgroundRunStore: useBackgroundRunStoreMock,
}));
vi.mock('@/features/chat/state/chat-store', () => ({
    useChatStore: useChatStoreMock,
}));
const { useAgentChat } = await import('../useAgentChat');
function emitAgentEvent(payload) {
    for (const handler of agentEventHandlers) {
        handler(payload);
    }
}
function emitRunCompleted(payload) {
    for (const handler of runCompletedHandlers) {
        handler(payload);
    }
}
function createSession() {
    return {
        id: SessionId('session-1'),
        title: 'SessionDetail',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 1,
        messages: [
            {
                id: MessageId('msg-1'),
                role: 'assistant',
                createdAt: 1,
                parts: [
                    {
                        type: 'tool-call',
                        toolCall: {
                            id: ToolCallId('tool-1'),
                            name: 'write',
                            args: { path: 'file.txt' },
                            state: 'input-complete',
                        },
                    },
                ],
            },
        ],
    };
}
function createSessionWithMessages(updatedAt, messages) {
    return {
        id: SessionId('session-1'),
        title: 'SessionDetail',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt,
        messages,
    };
}
function createSessionWithId(id) {
    return {
        id,
        title: `Session ${String(id)}`,
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
    };
}
function createSessionWithIdAndMessages(id, updatedAt, messages) {
    return {
        id,
        title: `Session ${String(id)}`,
        projectPath: `/tmp/${String(id)}`,
        createdAt: 1,
        updatedAt,
        messages,
    };
}
const SEND_PAYLOAD = {
    text: 'Hello world',
    thinkingLevel: 'medium',
    attachments: [],
};
function createDeferred() {
    let resolveValue = (_value) => { };
    const promise = new Promise((resolve) => {
        resolveValue = resolve;
    });
    return { promise, resolve: resolveValue };
}
export function installUseAgentChatTestLifecycle() {
    afterEach(async () => {
        await act(async () => {
            cleanup();
            await Promise.resolve();
        });
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });
    beforeEach(() => {
        apiMock.onAgentEvent.mockClear();
        apiMock.onRunCompleted.mockClear();
        apiMock.getBackgroundRun.mockReset();
        apiMock.getSessionDetail.mockReset();
        apiMock.sendMessage.mockReset();
        apiMock.sendWaggleMessage.mockReset();
        apiMock.cancelAgent.mockReset();
        apiMock.cancelAgent.mockResolvedValue(undefined);
        apiMock.steerAgent.mockReset();
        apiMock.respondAgentInteraction.mockReset();
        apiMock.respondAgentInteraction.mockResolvedValue({
            ok: true,
            interactionId: 'interaction-1',
            status: 'resolved',
        });
        getRunRenderSnapshotMock.mockClear();
        hasActiveRunMock.mockReset();
        hasActiveRunMock.mockReturnValue(false);
        runRenderSnapshots.clear();
        setRunRenderMessagesMock.mockClear();
        upsertSessionMock.mockReset();
        useChatStoreMock.mockClear();
        agentEventHandlers.length = 0;
        runCompletedHandlers.length = 0;
        useOptimisticUserMessageStore.setState({ messagesBySessionId: new Map() });
    });
}
export { apiMock, createDeferred, createSession, createSessionWithId, createSessionWithIdAndMessages, createSessionWithMessages, emitAgentEvent, emitRunCompleted, getRunRenderSnapshotMock, hasActiveRunMock, runRenderSnapshots, SEND_PAYLOAD, setRunRenderMessagesMock, useAgentChat, };
