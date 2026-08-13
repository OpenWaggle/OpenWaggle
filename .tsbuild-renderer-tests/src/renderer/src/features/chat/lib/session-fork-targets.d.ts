import type { SessionNodeId } from '@shared/types/brand';
import type { SessionWorkspace } from '@shared/types/session';
export interface SessionForkTarget {
    readonly entryId: SessionNodeId;
    readonly text: string;
}
export declare function getVisibleForkTargets(workspace: SessionWorkspace | null): readonly SessionForkTarget[];
