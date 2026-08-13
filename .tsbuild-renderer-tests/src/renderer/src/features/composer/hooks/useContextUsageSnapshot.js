import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('context-meter');
export function useContextUsageSnapshot({ activeSessionId, selectedModel, requestKey, }) {
    const [requestState, setRequestState] = useState({
        key: '',
        snapshot: null,
        failed: false,
    });
    useEffect(() => {
        if (!activeSessionId || typeof api.getContextUsage !== 'function')
            return;
        let cancelled = false;
        const currentRequestKey = requestKey;
        api
            .getContextUsage(activeSessionId, selectedModel)
            .then((snapshot) => {
            if (!cancelled)
                setRequestState({ key: currentRequestKey, snapshot, failed: false });
        })
            .catch((error) => {
            if (cancelled)
                return;
            logger.warn('Failed to load Pi context usage', {
                error: error instanceof Error ? error.message : String(error),
            });
            setRequestState({ key: currentRequestKey, snapshot: null, failed: true });
        });
        return () => {
            cancelled = true;
        };
    }, [activeSessionId, selectedModel, requestKey]);
    return {
        snapshot: requestState.key === requestKey ? requestState.snapshot : null,
        failed: requestState.key === requestKey && requestState.failed,
    };
}
