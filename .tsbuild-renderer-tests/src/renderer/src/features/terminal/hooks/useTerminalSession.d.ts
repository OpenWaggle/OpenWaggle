import { type RefObject } from 'react';
export declare function useTerminalSession(projectPath: string | null): {
    containerRef: RefObject<HTMLDivElement | null>;
    terminalStatus: {
        readonly isReady: boolean;
        readonly errorMessage: string | null;
    };
};
