function isToolResultOnlyMessage(message) {
    return message.parts.length > 0 && message.parts.every((part) => part.type === 'tool-result');
}
function sameWaggleTurn(current, previous) {
    const bothHaveSessionId = current?.sessionId !== undefined && previous?.sessionId !== undefined;
    return (current !== undefined &&
        previous !== undefined &&
        current.agentIndex === previous.agentIndex &&
        current.turnNumber === previous.turnNumber &&
        (!bothHaveSessionId || current.sessionId === previous.sessionId));
}
function getWaggleTurnId(meta, firstMessageId) {
    return [
        'waggle-turn',
        meta.sessionId ?? 'session',
        String(meta.turnNumber),
        String(meta.agentIndex),
        firstMessageId,
    ].join(':');
}
function withoutInlineTurnDivider(row) {
    return {
        ...row,
        showTurnDivider: false,
        turnDividerProps: undefined,
    };
}
function groupWaggleTurnRows(rows) {
    const groupedRows = [];
    for (const row of rows) {
        if (row.type !== 'message' || row.message.role !== 'assistant' || !row.waggleMeta) {
            groupedRows.push(row);
            continue;
        }
        const previousRow = groupedRows[groupedRows.length - 1];
        if (previousRow?.type === 'waggle-turn' &&
            sameWaggleTurn(row.waggleMeta, previousRow.messages[0]?.waggleMeta)) {
            groupedRows[groupedRows.length - 1] = {
                ...previousRow,
                messages: [...previousRow.messages, withoutInlineTurnDivider(row)],
            };
            continue;
        }
        groupedRows.push({
            type: 'waggle-turn',
            id: getWaggleTurnId(row.waggleMeta, row.message.id),
            agentColor: row.waggleMeta.agentColor,
            turnDividerProps: {
                turnNumber: row.waggleMeta.turnNumber,
                agentLabel: row.waggleMeta.agentLabel,
                agentColor: row.waggleMeta.agentColor,
                agentModel: row.waggleMeta.agentModel,
            },
            messages: [withoutInlineTurnDivider(row)],
        });
    }
    return groupedRows;
}
function toolCallIds(message) {
    const ids = new Set();
    for (const part of message.parts) {
        if (part.type === 'tool-call') {
            ids.add(part.id);
        }
    }
    return ids;
}
function canNestToolResultMessage(target, toolResults) {
    if (target.role !== 'assistant') {
        return false;
    }
    const ids = toolCallIds(target);
    return toolResults.some((part) => ids.has(part.toolCallId));
}
function appendToolResultParts(target, toolResults) {
    const existingResultIds = new Set(target.parts.flatMap((part) => (part.type === 'tool-result' ? [part.toolCallId] : [])));
    const nextResults = toolResults.filter((part) => !existingResultIds.has(part.toolCallId));
    return nextResults.length > 0 ? { ...target, parts: [...target.parts, ...nextResults] } : target;
}
function attachToolResultSource(toolResults, sourceMessageId) {
    return toolResults.map((part) => ({ ...part, sourceMessageId }));
}
function getSummaryRow(message) {
    const branchSummary = message.metadata?.branchSummary;
    if (branchSummary) {
        return {
            type: 'branch-summary',
            id: message.id,
            summary: branchSummary.summary,
        };
    }
    const compactionSummary = message.metadata?.compactionSummary;
    if (compactionSummary) {
        return {
            type: 'compaction-summary',
            id: message.id,
            summary: compactionSummary.summary,
            tokensBefore: compactionSummary.tokensBefore,
        };
    }
    return null;
}
function tryNestToolResultMessage(rows, message) {
    if (!isToolResultOnlyMessage(message)) {
        return false;
    }
    const previousRow = rows[rows.length - 1];
    const toolResults = message.parts.filter((part) => part.type === 'tool-result');
    const sourcedToolResults = attachToolResultSource(toolResults, message.id);
    if (previousRow?.type !== 'message' ||
        !canNestToolResultMessage(previousRow.message, sourcedToolResults)) {
        return false;
    }
    rows[rows.length - 1] = {
        ...previousRow,
        message: appendToolResultParts(previousRow.message, sourcedToolResults),
    };
    return true;
}
function createMessageRow({ message, meta, previousVisibleWaggleMeta, isStreaming, isLoading, }) {
    const showTurnDivider = !!meta && message.role === 'assistant' && !sameWaggleTurn(meta, previousVisibleWaggleMeta);
    return {
        type: 'message',
        message,
        isStreaming,
        isRunActive: isLoading,
        showTurnDivider,
        turnDividerProps: showTurnDivider
            ? {
                turnNumber: meta.turnNumber,
                agentLabel: meta.agentLabel,
                agentColor: meta.agentColor,
                agentModel: meta.agentModel,
            }
            : undefined,
        assistantModel: message.role === 'assistant' ? meta?.agentModel : undefined,
        waggle: meta ? { agentLabel: meta.agentLabel, agentColor: meta.agentColor } : undefined,
        waggleMeta: meta,
    };
}
function appendStatusRows(rows, params) {
    if (params.phase.current) {
        rows.push({
            type: 'phase-indicator',
            label: params.phase.current.label,
            elapsedMs: params.phase.current.elapsedMs,
        });
    }
    if (!params.phase.current && params.isLoading) {
        rows.push({
            type: 'phase-indicator',
            label: 'Thinking',
            elapsedMs: params.phase.totalElapsedMs,
        });
    }
    if (!params.isLoading && !params.phase.current && params.phase.completed.length > 0) {
        rows.push({
            type: 'run-summary',
            phases: params.phase.completed,
            totalMs: params.phase.totalElapsedMs,
        });
    }
    if (params.error && !params.isLoading) {
        rows.push({
            type: 'error',
            error: params.error,
            lastUserMessage: params.lastUserMessage,
            dismissedError: params.dismissedError,
            sessionId: params.sessionId ? String(params.sessionId) : null,
        });
    }
}
function appendCustomMessageRows(rows, customMessages) {
    for (const event of customMessages) {
        rows.push({ type: 'agent-loop-custom-message', event });
    }
}
function appendInteractionEventRows(rows, interactionEvents) {
    for (const event of interactionEvents) {
        rows.push({ type: 'agent-loop-interaction-event', event });
    }
}
function appendInterruptedRunRow(rows, params) {
    if (!params.interruptedRun || params.isLoading) {
        return;
    }
    rows.push({
        type: 'interrupted-run',
        runId: params.interruptedRun.runId,
        branchId: params.interruptedRun.branchId,
        runMode: params.interruptedRun.runMode,
        model: params.interruptedRun.model,
        interruptedAt: params.interruptedRun.interruptedAt,
    });
}
export function buildChatRows(params) {
    const rows = [];
    appendInterruptedRunRow(rows, params);
    const lastMessage = params.messages[params.messages.length - 1];
    const lastIsStreaming = params.isLoading && lastMessage?.role === 'assistant';
    let previousVisibleWaggleMeta;
    for (let index = 0; index < params.messages.length; index += 1) {
        const message = params.messages[index];
        const summaryRow = getSummaryRow(message);
        if (summaryRow) {
            rows.push(summaryRow);
            continue;
        }
        if (tryNestToolResultMessage(rows, message)) {
            continue;
        }
        const meta = params.waggleMetadataLookup[message.id];
        rows.push(createMessageRow({
            message,
            meta,
            previousVisibleWaggleMeta,
            isStreaming: lastIsStreaming && index === params.messages.length - 1,
            isLoading: params.isLoading,
        }));
        if (meta && message.role === 'assistant') {
            previousVisibleWaggleMeta = meta;
        }
    }
    appendCustomMessageRows(rows, params.customMessages ?? []);
    appendInteractionEventRows(rows, params.interactionEvents ?? []);
    appendStatusRows(rows, params);
    return groupWaggleTurnRows(rows);
}
