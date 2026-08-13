import type { SessionTreeFilterMode } from '@shared/types/session';
export declare function useSessionTreeFilterMode(projectPath: string | null, showToast: (message: string) => void): {
    filterMode: SessionTreeFilterMode;
    updateFilterMode: (value: string) => void;
};
