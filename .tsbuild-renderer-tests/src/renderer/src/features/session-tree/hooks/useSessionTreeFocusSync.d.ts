import type { SessionNode } from '@shared/types/session';
interface SessionTreeFocusSyncInput {
    readonly clampedFocusIndex: number;
    readonly rowRefs: React.RefObject<Map<string, HTMLButtonElement>>;
    readonly treeRowsRef: React.RefObject<HTMLDivElement | null>;
    readonly visibleNodes: readonly SessionNode[];
}
export declare function useSessionTreeFocusSync(input: SessionTreeFocusSyncInput): void;
export {};
