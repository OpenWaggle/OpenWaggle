function messageText(message) {
    const chunks = [];
    for (const part of message.parts) {
        if (part.type === 'text') {
            chunks.push(part.text);
        }
    }
    return chunks.join('\n').trim();
}
export function getVisibleForkTargets(workspace) {
    if (!workspace) {
        return [];
    }
    const targets = [];
    for (const entry of workspace.transcriptPath) {
        const message = entry.node.message;
        if (entry.node.kind !== 'user_message' || message?.role !== 'user') {
            continue;
        }
        const text = messageText(message);
        if (text) {
            targets.unshift({ entryId: entry.node.id, text });
        }
    }
    return targets;
}
