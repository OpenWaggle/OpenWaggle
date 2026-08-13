import { match, matchBy } from '@diegogbrisa/ts-match';
import { TOOL_STATE_RANK } from '@shared/constants/tool-state';
import { consumeUserMessageTextCount, countUserMessagesByText, getNonEmptyUserMessageText, } from './chat-message-text';
function isAssistantMessage(message) {
    return message.role === 'assistant';
}
function mergeTextContent(snapshotContent, currentContent) {
    return match({ snapshotContent, currentContent })
        .when((value) => value.snapshotContent.includes(value.currentContent), (value) => value.snapshotContent)
        .when((value) => value.currentContent.includes(value.snapshotContent), (value) => value.currentContent)
        .otherwise((value) => `${value.snapshotContent}${value.currentContent}`);
}
function toolStateRank(state) {
    return match(state)
        .with('complete', 'error', 'output-available', () => TOOL_STATE_RANK.TERMINAL)
        .with('executing', () => TOOL_STATE_RANK.EXECUTING)
        .with('input-complete', () => TOOL_STATE_RANK.INPUT_COMPLETE)
        .with('input-streaming', () => TOOL_STATE_RANK.INPUT_STREAMING)
        .otherwise(() => TOOL_STATE_RANK.UNKNOWN);
}
function findLastTextPartIndex(parts) {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        if (parts[index]?.type === 'text') {
            return index;
        }
    }
    return -1;
}
function findLastThinkingPartIndex(parts, stepId) {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const part = parts[index];
        if (part?.type !== 'thinking') {
            continue;
        }
        if (!stepId || part.stepId === stepId) {
            return index;
        }
    }
    return -1;
}
function findMergeablePartIndex(parts, part) {
    return matchBy(part, 'type')
        .with('text', () => findLastTextPartIndex(parts))
        .with('thinking', (value) => findLastThinkingPartIndex(parts, value.stepId))
        .with('tool-call', (value) => parts.findIndex((candidate) => candidate.type === 'tool-call' && candidate.id === value.id))
        .with('tool-result', (value) => parts.findIndex((candidate) => candidate.type === 'tool-result' && candidate.toolCallId === value.toolCallId))
        .with('image', (value) => parts.findIndex((candidate) => candidate.type === 'image' && candidate.source.value === value.source.value))
        .with('audio', (value) => parts.findIndex((candidate) => candidate.type === 'audio' && candidate.source.value === value.source.value))
        .with('video', (value) => parts.findIndex((candidate) => candidate.type === 'video' && candidate.source.value === value.source.value))
        .with('document', (value) => parts.findIndex((candidate) => candidate.type === 'document' && candidate.source.value === value.source.value))
        .exhaustive();
}
function mergeMessagePart(snapshotPart, currentPart) {
    return match({ snapshotPart, currentPart })
        .with({ snapshotPart: { type: 'text' }, currentPart: { type: 'text' } }, (value) => ({
        type: 'text',
        content: mergeTextContent(value.snapshotPart.content, value.currentPart.content),
    }))
        .with({ snapshotPart: { type: 'thinking' }, currentPart: { type: 'thinking' } }, (value) => {
        const stepId = value.currentPart.stepId ?? value.snapshotPart.stepId;
        return {
            type: 'thinking',
            content: mergeTextContent(value.snapshotPart.content, value.currentPart.content),
            ...(stepId ? { stepId } : {}),
        };
    })
        .with({ snapshotPart: { type: 'tool-call' }, currentPart: { type: 'tool-call' } }, (value) => toolStateRank(value.currentPart.state) >= toolStateRank(value.snapshotPart.state)
        ? value.currentPart
        : value.snapshotPart)
        .otherwise((value) => value.currentPart);
}
function mergeAssistantParts(snapshotParts, currentParts) {
    const mergedParts = [...snapshotParts];
    for (const currentPart of currentParts) {
        const partIndex = findMergeablePartIndex(mergedParts, currentPart);
        const existingPart = partIndex >= 0 ? mergedParts[partIndex] : undefined;
        if (!existingPart) {
            mergedParts.push(currentPart);
            continue;
        }
        mergedParts[partIndex] = mergeMessagePart(existingPart, currentPart);
    }
    return mergedParts;
}
export function mergeBackgroundReconnectMessages(reconnectMessages, currentMessages) {
    const currentMessagesById = new Map(currentMessages.map((message) => [message.id, message]));
    const reconnectMessageIds = new Set(reconnectMessages.map((message) => message.id));
    const reconnectUserCountsByText = countUserMessagesByText(reconnectMessages);
    const mergedMessages = reconnectMessages.map((message) => {
        const currentMessage = currentMessagesById.get(message.id);
        return match(currentMessage)
            .with(undefined, () => message)
            .when(isAssistantMessage, (currentAssistantMessage) => match(message)
            .when(isAssistantMessage, (assistantMessage) => ({
            ...assistantMessage,
            parts: mergeAssistantParts(assistantMessage.parts, currentAssistantMessage.parts),
            createdAt: currentAssistantMessage.createdAt ?? assistantMessage.createdAt,
            metadata: currentAssistantMessage.metadata ?? assistantMessage.metadata,
        }))
            .otherwise(() => currentAssistantMessage))
            .otherwise((value) => value);
    });
    for (const currentMessage of currentMessages) {
        if (!reconnectMessageIds.has(currentMessage.id)) {
            const currentUserText = getNonEmptyUserMessageText(currentMessage);
            if (currentUserText &&
                consumeUserMessageTextCount(reconnectUserCountsByText, currentUserText)) {
                continue;
            }
            mergedMessages.push(currentMessage);
        }
    }
    return mergedMessages;
}
