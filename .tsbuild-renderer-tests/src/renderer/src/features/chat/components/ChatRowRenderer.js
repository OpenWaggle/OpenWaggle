import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { matchBy } from '@diegogbrisa/ts-match';
import { TurnDivider } from '@/features/waggle/components';
import { AGENT_BORDER_LEFT } from '@/features/waggle/lib';
import { cn } from '@/shared/lib/cn';
import { CustomMessageRow } from './AgentLoopCustomMessageRow';
import { InteractionEventRow } from './AgentLoopInteractionEventRow';
import { StatusRow } from './AgentLoopStatusRow';
import { BranchSummaryCard } from './BranchSummaryCard';
import { ChatErrorDisplay } from './ChatErrorDisplay';
import { CompactionSummaryCard } from './CompactionSummaryCard';
import { InterruptedRunNotice } from './InterruptedRunNotice';
import { MessageBubble } from './MessageBubble';
function fallbackContext(props) {
    const extensions = {
        registry: props.extensionRegistry ?? null,
        projectPaths: props.extensionProjectPaths ?? [],
    };
    return {
        runtime: { sessionId: props.sessionId ?? null, extensions },
        extensions,
        actions: {
            onBranchFromMessage: props.onBranchFromMessage,
            onForkFromMessage: props.onForkFromMessage,
        },
        onOpenSettings: props.onOpenSettings,
        onRetry: props.onRetry,
        onDismissError: props.onDismissError ?? (() => undefined),
        onDismissInterruptedRun: props.onDismissInterruptedRun,
    };
}
function MessageRow({ row, context, }) {
    return (_jsxs("div", { className: "flex flex-col gap-6", children: [row.showTurnDivider && row.turnDividerProps && (_jsx(TurnDivider, { turnNumber: row.turnDividerProps.turnNumber, agentLabel: row.turnDividerProps.agentLabel, agentColor: row.turnDividerProps.agentColor, agentModel: row.turnDividerProps.agentModel })), _jsx(MessageBubble, { message: row.message, runtime: context.runtime, waggle: row.waggle, run: {
                    isStreaming: row.isStreaming,
                    isRunActive: row.isRunActive,
                    assistantModel: row.assistantModel,
                }, actions: context.actions })] }));
}
function WaggleTurnRow({ row, context, }) {
    return (_jsxs("section", { className: "flex flex-col gap-3", "data-waggle-turn": row.id, children: [_jsx(TurnDivider, { turnNumber: row.turnDividerProps.turnNumber, agentLabel: row.turnDividerProps.agentLabel, agentColor: row.turnDividerProps.agentColor, agentModel: row.turnDividerProps.agentModel }), _jsx("div", { className: cn('flex flex-col gap-5 border-l-2 pl-4', AGENT_BORDER_LEFT[row.agentColor]), children: row.messages.map((messageRow) => (_jsx(MessageBubble, { message: messageRow.message, runtime: context.runtime, waggle: messageRow.waggle, run: {
                        isStreaming: messageRow.isStreaming,
                        isRunActive: messageRow.isRunActive,
                        assistantModel: messageRow.assistantModel,
                    }, presentation: { hideAgentLabel: true }, actions: context.actions }, messageRow.message.id))) })] }));
}
export function ChatRowRenderer(props) {
    const context = props.context ?? fallbackContext(props);
    return matchBy(props.row, 'type')
        .with('interrupted-run', (row) => (_jsx(InterruptedRunNotice, { runId: row.runId, branchId: row.branchId, runMode: row.runMode, model: row.model, interruptedAt: row.interruptedAt, onDismiss: context.onDismissInterruptedRun })))
        .with('message', (row) => _jsx(MessageRow, { row: row, context: context }))
        .with('waggle-turn', (row) => _jsx(WaggleTurnRow, { row: row, context: context }))
        .with('branch-summary', (row) => (_jsx(BranchSummaryCard, { id: row.id, summary: row.summary, onBranchFromMessage: context.actions.onBranchFromMessage })))
        .with('compaction-summary', (row) => (_jsx(CompactionSummaryCard, { id: row.id, summary: row.summary, tokensBefore: row.tokensBefore, onBranchFromMessage: context.actions.onBranchFromMessage })))
        .with('agent-loop-custom-message', (row) => (_jsx(CustomMessageRow, { row: row, extensions: context.extensions })))
        .with('phase-indicator', 'run-summary', (row) => (_jsx(StatusRow, { row: row, extensions: context.extensions })))
        .with('agent-loop-interaction-event', (row) => (_jsx(InteractionEventRow, { event: row.event, extensions: context.extensions })))
        .with('error', (row) => (_jsx(ChatErrorDisplay, { error: row.error, lastUserMessage: row.lastUserMessage, dismissedError: row.dismissedError, sessionId: row.sessionId, onDismiss: context.onDismissError, onOpenSettings: context.onOpenSettings, onRetry: context.onRetry })))
        .exhaustive();
}
