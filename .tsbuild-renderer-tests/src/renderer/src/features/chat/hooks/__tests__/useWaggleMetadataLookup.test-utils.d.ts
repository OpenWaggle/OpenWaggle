import { MessageId, SessionId, SupportedModelId, ToolCallId } from '@shared/types/brand';
import type { WaggleConfig, WaggleMessageMetadata } from '@shared/types/waggle';
export declare function makeConfig(): {
    mode: "sequential";
    agents: [{
        label: string;
        model: SupportedModelId;
        roleDescription: string;
        color: "blue";
    }, {
        label: string;
        model: SupportedModelId;
        roleDescription: string;
        color: "amber";
    }];
    stop: {
        primary: "consensus";
        maxTurnsSafety: number;
    };
};
export declare function makeSessionDetail(config: WaggleConfig, metadata?: WaggleMessageMetadata): {
    id: SessionId;
    title: string;
    projectPath: null;
    createdAt: number;
    updatedAt: number;
    waggleConfig: WaggleConfig;
    messages: {
        id: MessageId;
        role: "assistant";
        createdAt: number;
        parts: {
            type: "text";
            text: string;
        }[];
        metadata: {
            waggle: WaggleMessageMetadata;
        } | undefined;
    }[];
};
export declare function makeAssistantMessage(id: string): {
    id: string;
    role: "assistant";
    parts: {
        type: "text";
        content: string;
    }[];
};
export declare function makeUserMessage(id: string): {
    id: string;
    role: "user";
    parts: {
        type: "text";
        content: string;
    }[];
};
export declare function makeProjectedSession(config: WaggleConfig): {
    architectMeta: WaggleMessageMetadata;
    reviewerMeta: WaggleMessageMetadata;
    session: {
        id: SessionId;
        title: string;
        projectPath: null;
        createdAt: number;
        updatedAt: number;
        waggleConfig: WaggleConfig;
        messages: ({
            id: MessageId;
            role: "assistant";
            createdAt: number;
            parts: {
                type: "text";
                text: string;
            }[];
            metadata: {
                waggle: WaggleMessageMetadata;
            };
        } | {
            id: MessageId;
            role: "assistant";
            createdAt: number;
            parts: {
                type: "tool-result";
                toolResult: {
                    id: ToolCallId;
                    name: string;
                    args: {};
                    result: string;
                    isError: false;
                    duration: number;
                };
            }[];
            metadata?: undefined;
        })[];
    };
};
