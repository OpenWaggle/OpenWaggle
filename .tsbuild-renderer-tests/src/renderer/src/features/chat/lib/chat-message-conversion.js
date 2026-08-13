import { matchBy } from '@diegogbrisa/ts-match';
import { formatAttachmentPreview } from './chat-attachment-preview';
/**
 * Convert a persisted agent message part into renderer UI parts.
 * This is the boundary between storage transport shapes and chat presentation state.
 */
export function messagePartToUIParts(part) {
    return matchBy(part, 'type')
        .with('text', (value) => [{ type: 'text', content: value.text }])
        .with('tool-call', (value) => [
        {
            type: 'tool-call',
            id: String(value.toolCall.id),
            name: value.toolCall.name,
            arguments: JSON.stringify(value.toolCall.args),
            state: value.toolCall.state ?? 'input-complete',
        },
    ])
        .with('tool-result', (value) => [
        {
            type: 'tool-result',
            toolCallId: String(value.toolResult.id),
            content: value.toolResult.result,
            state: value.toolResult.isError ? 'error' : 'complete',
        },
    ])
        .with('attachment', (value) => [
        {
            type: 'text',
            content: formatAttachmentPreview(value.attachment),
        },
    ])
        .with('reasoning', (value) => [
        {
            type: 'thinking',
            content: value.text,
        },
    ])
        .exhaustive();
}
export function sessionToUIMessages(session) {
    return session.messages.map((msg) => ({
        id: String(msg.id),
        role: msg.role,
        parts: msg.parts.flatMap(messagePartToUIParts),
        createdAt: new Date(msg.createdAt),
        ...(msg.metadata?.branchSummary || msg.metadata?.compactionSummary
            ? {
                metadata: {
                    ...(msg.metadata.branchSummary ? { branchSummary: msg.metadata.branchSummary } : {}),
                    ...(msg.metadata.compactionSummary
                        ? { compactionSummary: msg.metadata.compactionSummary }
                        : {}),
                },
            }
            : {}),
    }));
}
export function buildPartialAssistantMessage(parts, messageId) {
    const uiParts = parts.flatMap(messagePartToUIParts);
    if (uiParts.length === 0) {
        return null;
    }
    return {
        id: messageId ?? `bg-stream-${Date.now()}`,
        role: 'assistant',
        parts: uiParts,
        createdAt: new Date(),
    };
}
