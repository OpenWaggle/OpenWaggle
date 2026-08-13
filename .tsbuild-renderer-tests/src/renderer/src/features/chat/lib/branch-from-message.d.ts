import { SessionNodeId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { SessionNode, SessionWorkspace } from '@shared/types/session';
interface CreateBranchDraftSelectionInput {
    readonly messages: readonly UIMessage[];
    readonly workspace: SessionWorkspace | null;
    readonly messageId: string;
}
export interface BranchDraftSelection {
    readonly sourceNodeId: SessionNodeId;
    readonly routeNodeId: SessionNodeId;
    readonly prefillText?: string;
}
export declare function createBranchDraftSelectionFromNode(node: SessionNode): BranchDraftSelection;
export declare function createBranchDraftSelection({ messages, workspace, messageId, }: CreateBranchDraftSelectionInput): BranchDraftSelection;
export declare function shouldPromptForBranchSummary(workspace: SessionWorkspace | null, targetNodeId: SessionNodeId): boolean;
export {};
