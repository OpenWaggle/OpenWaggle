import { SessionBranchId, SessionId, SupportedModelId } from '@shared/types/brand';
import type { UIMessage } from '@shared/types/chat-ui';
import type { WaggleMessageMetadata } from '@shared/types/waggle';
import { buildChatRows } from '../useBuildChatRows';
declare function createUserMessage(id: string, text: string): {
    id: string;
    role: string;
    parts: {
        type: string;
        content: string;
    }[];
};
declare function createAssistantToolMessage(id: string, toolCallId: string): {
    id: string;
    role: string;
    parts: ({
        type: string;
        id: string;
        name: string;
        arguments: string;
        state: string;
        toolCallId?: undefined;
        output?: undefined;
    } | {
        type: string;
        toolCallId: string;
        output: {
            kind: string;
            text: string;
        };
        state: string;
        id?: undefined;
        name?: undefined;
        arguments?: undefined;
    })[];
};
declare function createToolResultMessage(id: string, toolCallId: string): {
    id: string;
    role: string;
    parts: {
        type: string;
        toolCallId: string;
        content: {
            kind: string;
            text: string;
        };
        state: string;
    }[];
};
declare function createAssistantPendingToolMessage(id: string, toolCallId: string, text: string): {
    id: string;
    role: string;
    parts: ({
        type: string;
        content: string;
        id?: undefined;
        name?: undefined;
        arguments?: undefined;
        state?: undefined;
    } | {
        type: string;
        id: string;
        name: string;
        arguments: string;
        state: string;
        content?: undefined;
    })[];
};
declare function createAssistantTerminalToolMessage(id: string, toolCallId: string, text: string): {
    id: string;
    role: string;
    parts: ({
        type: string;
        id: string;
        name: string;
        arguments: string;
        state: string;
        toolCallId?: undefined;
        output?: undefined;
        content?: undefined;
    } | {
        type: string;
        toolCallId: string;
        output: {
            success: boolean;
            path: string;
        };
        state: string;
        id?: undefined;
        name?: undefined;
        arguments?: undefined;
        content?: undefined;
    } | {
        type: string;
        content: string;
        id?: undefined;
        name?: undefined;
        arguments?: undefined;
        state?: undefined;
        toolCallId?: undefined;
        output?: undefined;
    })[];
};
declare function getAssistantMessageRows(messages: UIMessage[], waggleMetadataLookup?: Readonly<Record<string, WaggleMessageMetadata>>): import("../../lib/types-chat-row").ChatRow[];
declare function getWaggleTurnRows(messages: UIMessage[], waggleMetadataLookup: Readonly<Record<string, WaggleMessageMetadata>>): import("../../lib/types-chat-row").WaggleTurnChatRow[];
export type { UIMessage, WaggleMessageMetadata };
export { buildChatRows, createAssistantPendingToolMessage, createAssistantTerminalToolMessage, createAssistantToolMessage, createToolResultMessage, createUserMessage, getAssistantMessageRows, getWaggleTurnRows, SessionBranchId, SessionId, SupportedModelId, };
