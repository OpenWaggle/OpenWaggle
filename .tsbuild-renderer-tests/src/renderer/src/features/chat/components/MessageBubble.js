import { jsx as _jsx } from "react/jsx-runtime";
import { AssistantMessageBubble } from './AssistantMessageBubble';
import { UserMessageBubble } from './UserMessageBubble';
export function MessageBubble({ message, runtime, waggle, run, presentation, actions, }) {
    if (message.role === 'user') {
        return (_jsx(UserMessageBubble, { message: message, onBranchFromMessage: actions?.onBranchFromMessage, onForkFromMessage: actions?.onForkFromMessage }));
    }
    return (_jsx(AssistantMessageBubble, { message: message, runtime: runtime, run: run, waggle: waggle, presentation: presentation, actions: {
            ...(actions?.onBranchFromMessage
                ? { onBranchFromMessage: actions.onBranchFromMessage }
                : {}),
            ...(actions?.onViewTurnDiff && actions.turnAnchorMessageIds?.has(message.id)
                ? { onViewTurnDiff: actions.onViewTurnDiff }
                : {}),
        } }));
}
