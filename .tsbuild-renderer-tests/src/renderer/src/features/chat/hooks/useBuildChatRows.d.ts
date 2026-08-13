import type { UIMessage } from '@shared/types/chat-ui';
import type { SessionInterruptedRun } from '@shared/types/session';
import type { AgentTransportCustomEvent } from '@shared/types/stream';
import type { WaggleMessageMetadata } from '@shared/types/waggle';
import type { StreamingPhaseState } from '@/features/chat/hooks/useStreamingPhase';
import type { AgentInteractionEvent, ChatRow } from '../lib/types-chat-row';
interface BuildChatRowsParams {
    messages: UIMessage[];
    customMessages?: readonly AgentTransportCustomEvent[];
    interactionEvents?: readonly AgentInteractionEvent[];
    isLoading: boolean;
    error: Error | undefined;
    lastUserMessage: string | null;
    dismissedError: string | null;
    sessionId: string | null;
    waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>;
    phase: StreamingPhaseState;
    interruptedRun?: SessionInterruptedRun;
}
export declare function buildChatRows(params: BuildChatRowsParams): ChatRow[];
export {};
