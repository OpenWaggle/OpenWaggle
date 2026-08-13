import type { SessionId } from '@shared/types/brand';
import type { SupportedModelId } from '@shared/types/llm';
import type { SessionDetail } from '@shared/types/session';
import type { ThinkingLevel } from '@shared/types/settings';
import type { AgentChatReturn } from './useAgentChat.types';
export type { AgentChatStatus, AgentCompactionStatus } from './useAgentChat.types';
export declare function useAgentChat(sessionId: SessionId | null, session: SessionDetail | null, model: SupportedModelId, _thinkingLevel: ThinkingLevel): AgentChatReturn;
