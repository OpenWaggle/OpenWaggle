import type { SupportedModelId } from '@shared/types/brand';
import type { SessionNode, SessionTree, SessionWorkspace } from '@shared/types/session';
interface SessionTreeNodeSelectionInput {
    readonly activeWorkspace: SessionWorkspace | null;
    readonly selectedModel: SupportedModelId;
    readonly showToast: (message: string) => void;
    readonly tree: SessionTree | null;
}
export declare function useSessionTreeNodeSelection(input: SessionTreeNodeSelectionInput): {
    selectNode: (node: SessionNode) => void;
};
export {};
