import type { AgentSendPayload } from '@shared/types/agent';
import type { SessionId } from '@shared/types/brand';
import type { SupportedModelId } from '@shared/types/llm';
import type { ThinkingLevel } from '@shared/types/settings';
import type { WaggleConfig } from '@shared/types/waggle';
interface SendMessageDeps {
    readonly activeSessionId: SessionId | null;
    readonly projectPath: string | null;
    readonly thinkingLevel: ThinkingLevel;
    readonly createSession: (projectPath: string) => Promise<SessionId>;
    readonly sendMessage: (payload: AgentSendPayload) => Promise<void>;
    readonly sendMessageToSession: (sessionId: SessionId, payload: AgentSendPayload, config: WaggleConfig | null) => Promise<void>;
    readonly sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>;
}
interface SendMessageHandlers {
    readonly handleSend: (payload: AgentSendPayload) => Promise<void>;
    readonly handleSendText: (content: string) => Promise<void>;
    readonly handleSendWaggle: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>;
}
/** Pure factory — testable without React. */
export declare function createSendHandlers(deps: SendMessageDeps): SendMessageHandlers;
interface UseSendMessageOptions {
    readonly activeSessionId: SessionId | null;
    readonly model: SupportedModelId;
    readonly projectPath: string | null;
    readonly thinkingLevel: ThinkingLevel;
    readonly createSession: (projectPath: string) => Promise<SessionId>;
    readonly sendMessage: (payload: AgentSendPayload) => Promise<void>;
    readonly sendWaggleMessage: (payload: AgentSendPayload, config: WaggleConfig) => Promise<void>;
}
/** Hook wrapper — binds first-message sends to the concrete created session id. */
export declare function useSendMessage(options: UseSendMessageOptions): SendMessageHandlers;
export {};
