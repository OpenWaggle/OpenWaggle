import { isAgentLoopTranscriptNode, readAgentLoopEventFromNode, } from './agent-loop-transcript-event-parser';
function readAgentLoopEventsFromNodes(nodes) {
    const customMessages = [];
    const interactionEvents = [];
    for (const node of nodes) {
        const event = readAgentLoopEventFromNode(node);
        if (event === null) {
            continue;
        }
        if (event.type === 'custom') {
            customMessages.push(event);
        }
        else {
            interactionEvents.push(event);
        }
    }
    return { customMessages, interactionEvents };
}
function compareWorkspaceNodes(left, right) {
    return left.timestampMs - right.timestampMs || left.createdOrder - right.createdOrder;
}
function hasTranscriptPathAnchor(input) {
    const visited = new Set();
    let parentId = input.node.parentId;
    while (parentId) {
        if (input.transcriptNodeIds.has(parentId)) {
            return true;
        }
        if (visited.has(parentId)) {
            return false;
        }
        visited.add(parentId);
        const parent = input.nodeById.get(parentId);
        if (!parent || !isAgentLoopTranscriptNode(parent)) {
            return false;
        }
        parentId = parent.parentId;
    }
    return false;
}
export function readAgentLoopEventsFromWorkspace(workspace) {
    const transcriptNodeIds = new Set(workspace.transcriptPath.map((entry) => String(entry.node.id)));
    const nodeById = new Map(workspace.tree.nodes.map((node) => [String(node.id), node]));
    const visibleNodes = workspace.tree.nodes.filter((node) => transcriptNodeIds.has(String(node.id)) ||
        hasTranscriptPathAnchor({
            node,
            nodeById,
            transcriptNodeIds,
        }));
    return readAgentLoopEventsFromNodes([...visibleNodes].sort(compareWorkspaceNodes));
}
function customMessageKey(event) {
    return `${event.timestamp}:${event.name}:${JSON.stringify(event.value ?? null)}`;
}
function interactionEventKey(event) {
    return event.type === 'agent_interaction_request'
        ? `request:${String(event.interaction.sessionId)}:${event.interaction.runId}:${event.interaction.interactionId}`
        : `resolved:${event.runId}:${event.interactionId}:${event.status}`;
}
export function mergeCustomMessages(persisted, live) {
    const eventsByKey = new Map(persisted.map((event) => [customMessageKey(event), event]));
    for (const event of live) {
        eventsByKey.set(customMessageKey(event), event);
    }
    return [...eventsByKey.values()].sort((left, right) => left.timestamp - right.timestamp);
}
export function mergeInteractionEvents(persisted, live) {
    const eventsByKey = new Map(persisted.map((event) => [interactionEventKey(event), event]));
    for (const event of live) {
        eventsByKey.set(interactionEventKey(event), event);
    }
    return [...eventsByKey.values()].sort((left, right) => left.timestamp - right.timestamp);
}
