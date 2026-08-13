function createAssistantMessage(messageId) {
    return {
        id: messageId,
        role: 'assistant',
        parts: [],
        createdAt: new Date(),
    };
}
export function ensureAssistantMessage(messages, messageId) {
    const existing = messages.find((message) => message.id === messageId);
    if (existing) {
        return [...messages];
    }
    return [...messages, createAssistantMessage(messageId)];
}
function replaceMessage(messages, messageId, update) {
    let changed = false;
    const nextMessages = messages.map((message) => {
        if (message.id !== messageId) {
            return message;
        }
        changed = true;
        return update(message);
    });
    return changed ? nextMessages : [...messages];
}
function findToolCallPartIndex(parts, toolCallId) {
    return parts.findIndex((part) => part.type === 'tool-call' && part.id === toolCallId);
}
function findThinkingPartIndex(parts, stepId) {
    return parts.findIndex((part) => part.type === 'thinking' && part.stepId === stepId);
}
export function findLatestAssistantMessageId(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === 'assistant') {
            return message.id;
        }
    }
    return null;
}
export function findAssistantMessageIdForToolCall(messages, toolCallId) {
    for (const message of messages) {
        if (message.role === 'assistant' &&
            message.parts.some((part) => part.type === 'tool-call' && part.id === toolCallId)) {
            return message.id;
        }
    }
    return null;
}
export function updateAssistantParts(messages, messageId, update) {
    return replaceMessage(messages, messageId, (message) => ({
        ...message,
        parts: update(message.parts),
    }));
}
export function appendTextDelta(messages, messageId, delta) {
    const ensuredMessages = ensureAssistantMessage(messages, messageId);
    return updateAssistantParts(ensuredMessages, messageId, (parts) => {
        const lastPart = parts[parts.length - 1];
        if (lastPart?.type === 'text') {
            return [
                ...parts.slice(0, -1),
                {
                    type: 'text',
                    content: lastPart.content + delta,
                },
            ];
        }
        return [...parts, { type: 'text', content: delta }];
    });
}
function makeThinkingStepId(messageId, contentIndex) {
    return `${messageId}:thinking:${String(contentIndex)}`;
}
export function ensureThinkingStep(messages, messageId, contentIndex) {
    const stepId = makeThinkingStepId(messageId, contentIndex);
    return updateAssistantParts(ensureAssistantMessage(messages, messageId), messageId, (parts) => {
        const partIndex = findThinkingPartIndex(parts, stepId);
        if (partIndex !== -1) {
            return parts;
        }
        return [...parts, { type: 'thinking', content: '', stepId }];
    });
}
export function appendThinkingDelta(messages, messageId, contentIndex, delta) {
    const stepId = makeThinkingStepId(messageId, contentIndex);
    const ensuredMessages = ensureThinkingStep(messages, messageId, contentIndex);
    return updateAssistantParts(ensuredMessages, messageId, (parts) => {
        const partIndex = findThinkingPartIndex(parts, stepId);
        const part = parts[partIndex];
        if (part?.type !== 'thinking') {
            return parts;
        }
        return [
            ...parts.slice(0, partIndex),
            {
                type: 'thinking',
                content: part.content + delta,
                stepId,
            },
            ...parts.slice(partIndex + 1),
        ];
    });
}
export function stringifyToolInput(input) {
    if (typeof input === 'string') {
        return input;
    }
    if (input === undefined) {
        return '';
    }
    try {
        return JSON.stringify(input);
    }
    catch {
        return String(input);
    }
}
export function ensureToolCall(messages, messageId, toolCallId, toolName, input) {
    const ensuredMessages = ensureAssistantMessage(messages, messageId);
    return updateAssistantParts(ensuredMessages, messageId, (parts) => {
        const partIndex = findToolCallPartIndex(parts, toolCallId);
        if (partIndex !== -1) {
            return parts;
        }
        return [
            ...parts,
            {
                type: 'tool-call',
                id: toolCallId,
                name: toolName,
                arguments: stringifyToolInput(input),
                state: input === undefined ? 'input-streaming' : 'input-complete',
            },
        ];
    });
}
export function updateToolCall(messages, toolCallId, update) {
    return messages.map((message) => ({
        ...message,
        parts: message.parts.map((part) => {
            if (part.type !== 'tool-call' || part.id !== toolCallId) {
                return part;
            }
            return update(part);
        }),
    }));
}
export function appendToolCallArgs(messages, toolCallId, delta) {
    return updateToolCall(messages, toolCallId, (part) => ({
        ...part,
        arguments: part.arguments + delta,
        state: 'input-streaming',
    }));
}
export function updateToolCallInput(messages, toolCallId, input, state) {
    return updateToolCall(messages, toolCallId, (part) => ({
        ...part,
        arguments: stringifyToolInput(input),
        state,
    }));
}
export function finalizeToolCallInput(messages, toolCallId, input) {
    return updateToolCall(messages, toolCallId, (part) => ({
        ...part,
        arguments: stringifyToolInput(input),
        state: 'input-complete',
    }));
}
