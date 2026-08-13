import { useState } from 'react';
import { useMessageQueueStore } from '@/features/chat/state';
import { createRendererLogger } from '@/shared/lib/logger';
import { reportQueuedSteerFailure } from '../lib/queue-failure-feedback';
const logger = createRendererLogger('chat-panel');
export function useSteerWorkflow(deps) {
    const [isSteering, setIsSteering] = useState(false);
    const { activeSessionId, steer, previewSteeredUserTurn, withDeferredSnapshotRefresh, handleSendWithWaggle, showToast, } = deps;
    async function handleSteer(messageId) {
        if (!activeSessionId)
            return;
        const queue = useMessageQueueStore.getState().queues.get(activeSessionId);
        const item = queue?.find((i) => i.id === messageId);
        if (!item)
            return;
        setIsSteering(true);
        useMessageQueueStore.getState().dismiss(activeSessionId, messageId);
        const clearOptimisticSteeredTurn = previewSteeredUserTurn(item.payload);
        try {
            await withDeferredSnapshotRefresh(async () => {
                await steer();
                await handleSendWithWaggle(item.payload);
            });
        }
        catch (error) {
            clearOptimisticSteeredTurn();
            useMessageQueueStore.getState().enqueue(activeSessionId, item.payload);
            reportQueuedSteerFailure({ logger, showToast }, activeSessionId, messageId, error);
        }
        finally {
            setIsSteering(false);
        }
    }
    return { isSteering, handleSteer };
}
