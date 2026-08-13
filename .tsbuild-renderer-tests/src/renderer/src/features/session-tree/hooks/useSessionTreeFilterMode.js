import { useEffect, useState } from 'react';
import { api } from '@/shared/lib/ipc';
import { isSessionTreeFilterMode } from '../constants';
export function useSessionTreeFilterMode(projectPath, showToast) {
    const [filterMode, setFilterMode] = useState('default');
    useEffect(() => {
        let cancelled = false;
        void api
            .getPiTreeFilterMode(projectPath)
            .then((mode) => {
            if (!cancelled) {
                setFilterMode(mode);
            }
        })
            .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            showToast(`Failed to load Session Tree filter: ${message}`);
        });
        return () => {
            cancelled = true;
        };
    }, [projectPath, showToast]);
    function persistFilterMode(mode) {
        void api.setPiTreeFilterMode(mode, projectPath).catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            showToast(`Failed to save Session Tree filter: ${message}`);
        });
    }
    function updateFilterMode(value) {
        if (!isSessionTreeFilterMode(value)) {
            return;
        }
        setFilterMode(value);
        persistFilterMode(value);
    }
    return { filterMode, updateFilterMode };
}
