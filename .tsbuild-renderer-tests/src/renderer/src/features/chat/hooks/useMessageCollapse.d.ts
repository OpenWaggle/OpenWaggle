import type { UIMessage } from '@shared/types/chat-ui';
export interface UseMessageCollapseResult {
    canCollapseDetails: boolean;
    showDetails: boolean;
    toggleDetails: () => void;
    collapseLabel: string;
    lastRenderableTextPartIndex: number;
    renderAllParts: boolean;
}
export declare function useMessageCollapse(message: UIMessage, isStreaming: boolean | undefined, isRunActive: boolean | undefined, isWaggle?: boolean): UseMessageCollapseResult;
