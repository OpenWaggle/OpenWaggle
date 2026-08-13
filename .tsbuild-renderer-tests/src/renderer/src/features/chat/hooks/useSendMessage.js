import { createOptimisticUserMessage } from '@/features/chat/lib/useAgentChat.utils';
import { useBackgroundRunStore } from '@/features/chat/state/background-run-store';
import { useOptimisticUserMessageStore } from '@/features/chat/state/optimistic-user-message-store';
import { flushDraftWorktreePlanToSession } from '@/features/git';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('use-send-message');
/** Pure factory — testable without React. */
export function createSendHandlers(deps) {
    const { activeSessionId, projectPath, thinkingLevel, createSession, sendMessage, sendMessageToSession, sendWaggleMessage, } = deps;
    async function handleSend(payload) {
        if (!activeSessionId) {
            if (!projectPath) {
                throw new Error('Select a project before sending.');
            }
            const sessionId = await createSession(projectPath);
            await flushDraftWorktreePlanToSession(projectPath, sessionId);
            void sendMessageToSession(sessionId, payload, null);
            return;
        }
        await sendMessage(payload);
    }
    async function handleSendText(content) {
        await handleSend({ text: content, thinkingLevel, attachments: [] });
    }
    async function handleSendWaggle(payload, config) {
        if (!activeSessionId) {
            if (!projectPath) {
                throw new Error('Select a project before sending.');
            }
            const sessionId = await createSession(projectPath);
            await flushDraftWorktreePlanToSession(projectPath, sessionId);
            void sendMessageToSession(sessionId, payload, config);
            return;
        }
        await sendWaggleMessage(payload, config);
    }
    return { handleSend, handleSendText, handleSendWaggle };
}
/** Hook wrapper — binds first-message sends to the concrete created session id. */
export function useSendMessage(options) {
    const { activeSessionId, model, sendMessage, sendWaggleMessage, ...rest } = options;
    async function sendMessageToSession(sessionId, payload, config) {
        const optimisticUserMessage = createOptimisticUserMessage(payload);
        useOptimisticUserMessageStore.getState().add(sessionId, optimisticUserMessage);
        useBackgroundRunStore.getState().setRunRenderMessages(sessionId, [optimisticUserMessage]);
        try {
            if (config) {
                await api.sendWaggleMessage(sessionId, payload, model, config);
            }
            else {
                await api.sendMessage(sessionId, payload, model);
            }
        }
        catch (error) {
            useBackgroundRunStore.getState().clearRunRenderSnapshot(sessionId);
            logger.error('First message send failed', {
                sessionId: String(sessionId),
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    return createSendHandlers({
        ...rest,
        activeSessionId,
        sendMessage,
        sendMessageToSession,
        sendWaggleMessage,
    });
}
