import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand';
import { buildChatRows } from '../useBuildChatRows';
function createUserMessage(id, text) {
    return {
        id,
        role: 'user',
        parts: [{ type: 'text', content: text }],
    };
}
function createAssistantToolMessage(id, toolCallId) {
    return {
        id,
        role: 'assistant',
        parts: [
            {
                type: 'tool-call',
                id: toolCallId,
                name: 'bash',
                arguments: '{"command":"echo hello"}',
                state: 'output-available',
            },
            {
                type: 'tool-result',
                toolCallId,
                output: { kind: 'text', text: 'hello' },
                state: 'output-available',
            },
        ],
    };
}
function createToolResultMessage(id, toolCallId) {
    return {
        id,
        role: 'assistant',
        parts: [
            {
                type: 'tool-result',
                toolCallId,
                content: { kind: 'text', text: 'hello' },
                state: 'complete',
            },
        ],
    };
}
function createAssistantPendingToolMessage(id, toolCallId, text) {
    return {
        id,
        role: 'assistant',
        parts: [
            { type: 'text', content: text },
            {
                type: 'tool-call',
                id: toolCallId,
                name: 'write',
                arguments: '{"path":"pending-reload-check.txt","content":"reload should not fake success"}',
                state: 'input-complete',
            },
        ],
    };
}
function createAssistantTerminalToolMessage(id, toolCallId, text) {
    return {
        id,
        role: 'assistant',
        parts: [
            {
                type: 'tool-call',
                id: toolCallId,
                name: 'write',
                arguments: '{"path":"pending-reload-check.txt","content":"reload should not fake success"}',
                state: 'output-available',
            },
            {
                type: 'tool-result',
                toolCallId,
                output: { success: true, path: 'pending-reload-check.txt' },
                state: 'output-available',
            },
            { type: 'text', content: text },
        ],
    };
}
function getAssistantMessageRows(messages, waggleMetadataLookup = {}) {
    const rows = buildChatRows({
        messages,
        isLoading: false,
        error: undefined,
        lastUserMessage: null,
        dismissedError: null,
        sessionId: 'session-rows',
        waggleMetadataLookup,
        phase: { current: null, completed: [], totalElapsedMs: 0 },
    });
    return rows.filter((row) => row.type === 'message' && row.message.role === 'assistant');
}
function getWaggleTurnRows(messages, waggleMetadataLookup) {
    const rows = buildChatRows({
        messages,
        isLoading: false,
        error: undefined,
        lastUserMessage: null,
        dismissedError: null,
        sessionId: 'session-rows',
        waggleMetadataLookup,
        phase: { current: null, completed: [], totalElapsedMs: 0 },
    });
    return rows.filter((row) => row.type === 'waggle-turn');
}
export { buildChatRows, createAssistantPendingToolMessage, createAssistantTerminalToolMessage, createAssistantToolMessage, createToolResultMessage, createUserMessage, getAssistantMessageRows, getWaggleTurnRows, SessionBranchId, SessionId, SupportedModelId, };
