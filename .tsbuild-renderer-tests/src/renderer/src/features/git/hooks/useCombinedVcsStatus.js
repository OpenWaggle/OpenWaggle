import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/shared/lib/ipc';
import { createRendererLogger } from '@/shared/lib/logger';
const logger = createRendererLogger('git');
/**
 * Loads the combined VCS status for a project: Local status resolves instantly,
 * Remote status loads asynchronously and is merged in when it arrives. Returns
 * null until the local half is available.
 */
export function useCombinedVcsStatus(projectPath) {
    const [local, setLocal] = useState(null);
    const [remote, setRemote] = useState(null);
    const requestedPath = useRef(projectPath);
    const refresh = useCallback(async () => {
        requestedPath.current = projectPath;
        if (!projectPath || typeof api.getLocalVcsStatus !== 'function') {
            setLocal(null);
            setRemote(null);
            return;
        }
        try {
            const localResult = await api.getLocalVcsStatus(projectPath);
            if (requestedPath.current !== projectPath)
                return;
            setLocal(localResult.ok ? localResult.status : null);
        }
        catch (error) {
            logger.warn('Failed to load local VCS status', { error: String(error) });
            setLocal(null);
        }
        if (typeof api.getRemoteVcsStatus !== 'function')
            return;
        try {
            const remoteResult = await api.getRemoteVcsStatus(projectPath);
            if (requestedPath.current !== projectPath)
                return;
            setRemote(remoteResult.ok ? remoteResult.status : null);
        }
        catch (error) {
            logger.warn('Failed to load remote VCS status', { error: String(error) });
            setRemote(null);
        }
    }, [projectPath]);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const status = local ? { ...local, ...(remote ?? EMPTY_REMOTE) } : null;
    return { status, local, remote, refresh };
}
const EMPTY_REMOTE = {
    hasUpstream: false,
    aheadCount: 0,
    behindCount: 0,
    aheadOfDefaultCount: null,
    changeRequest: null,
};
