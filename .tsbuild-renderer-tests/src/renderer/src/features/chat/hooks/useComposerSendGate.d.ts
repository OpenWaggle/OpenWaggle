import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
import type { SessionDetail } from '@shared/types/session';
import { type SessionContextRowState } from '@/features/git';
interface UseComposerSendGateInput {
    readonly activeSessionId: SessionId | null;
    readonly session: SessionDetail | null;
    readonly isFirstMessage: boolean;
    readonly onSend: (payload: AgentSendPayload) => Promise<void>;
    readonly onToast: (message: string) => void;
}
/**
 * Wires the composer context strip (WS1b) and gates send: a worktree-mode first
 * send is blocked (with a toast) until a Worktree base ref is resolvable.
 */
export declare function useComposerSendGate(input: UseComposerSendGateInput): {
    readonly strip: SessionContextRowState;
    readonly guardedSend: (payload: AgentSendPayload) => Promise<void>;
};
export {};
