import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { SessionId, SupportedModelId } from '@shared/types/brand';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/features/waggle/components/TurnDivider', () => ({
    TurnDivider: ({ turnNumber, agentLabel, agentModel, }) => (_jsxs("div", { "data-testid": "turn-divider", children: ["Turn ", turnNumber + 1, ": ", agentLabel, agentModel ? ` · ${agentModel}` : ''] })),
}));
vi.mock('../MessageBubble', () => ({
    MessageBubble: ({ message, run, waggle, presentation, }) => (_jsxs("div", { "data-testid": "message-bubble", children: [_jsx("span", { children: message.id }), !presentation?.hideAgentLabel && (waggle || run?.assistantModel) ? (_jsxs("span", { "data-testid": "message-agent-label", children: [waggle?.agentLabel, run?.assistantModel] })) : null] })),
}));
import { ChatRowRenderer } from '../ChatRowRenderer';
function assistantMessage(id) {
    return {
        id,
        role: 'assistant',
        parts: [{ type: 'text', content: id }],
    };
}
function messageRow(message) {
    return {
        type: 'message',
        message,
        isStreaming: false,
        isRunActive: false,
        showTurnDivider: false,
        assistantModel: SupportedModelId('openai/gpt-5.5'),
        waggle: { agentLabel: 'Architect', agentColor: 'blue' },
        waggleMeta: {
            agentIndex: 0,
            agentLabel: 'Architect',
            agentColor: 'blue',
            agentModel: SupportedModelId('openai/gpt-5.5'),
            turnNumber: 0,
            sessionId: 'session-1',
        },
    };
}
describe('ChatRowRenderer', () => {
    it('shows agent and model once for a grouped waggle turn', () => {
        const row = {
            type: 'waggle-turn',
            id: 'waggle-turn:session-1:0:0:assistant-1',
            agentColor: 'blue',
            turnDividerProps: {
                turnNumber: 0,
                agentLabel: 'Architect',
                agentColor: 'blue',
                agentModel: SupportedModelId('openai/gpt-5.5'),
            },
            messages: [
                messageRow(assistantMessage('assistant-1')),
                messageRow(assistantMessage('tool-1')),
            ],
        };
        render(_jsx(ChatRowRenderer, { row: row, sessionId: SessionId('session-1'), onDismissError: vi.fn() }));
        expect(screen.getByTestId('turn-divider')).toHaveTextContent('Turn 1: Architect');
        expect(screen.getByTestId('turn-divider')).toHaveTextContent('openai/gpt-5.5');
        expect(screen.getAllByTestId('message-bubble')).toHaveLength(2);
        expect(screen.queryByTestId('message-agent-label')).toBeNull();
    });
});
