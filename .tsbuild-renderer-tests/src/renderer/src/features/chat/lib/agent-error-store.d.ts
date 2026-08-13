import { type AgentErrorInfo } from '@shared/types/errors';
export declare function getLastAgentErrorInfo(sessionId: string): AgentErrorInfo | null;
export declare function clearLastAgentErrorInfo(sessionId: string): void;
export declare function setLastAgentErrorInfo(sessionId: string, error: {
    readonly message: string;
    readonly code?: string;
}): void;
