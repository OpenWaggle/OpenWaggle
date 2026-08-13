import type { SessionNode, SessionTreeFilterMode } from '@shared/types/session';
export declare function filterSessionTreeNodes(nodes: readonly SessionNode[], mode: SessionTreeFilterMode): readonly SessionNode[];
export declare function searchSessionTreeNodes(input: {
    readonly nodes: readonly SessionNode[];
    readonly filteredNodes: readonly SessionNode[];
    readonly query: string;
}): readonly SessionNode[];
