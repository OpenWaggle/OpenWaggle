import type { ChatToolCallPart } from '@shared/types/chat-ui';
import type { JsonObject, JsonValue } from '@shared/types/json';
import type { ExtensionAgentLoopTarget } from './extension-agent-loop-resolution';
export declare const CUSTOM_INTERACTION_UNAVAILABLE_ACTION_ID = "custom-renderer-unavailable";
export declare const CUSTOM_INTERACTION_RESPONSE_ACTION_ID: "custom-interaction-response";
export interface ExtensionToolResultView {
    readonly content: string;
    readonly state: string;
    readonly error?: string;
}
export interface ExtensionCustomMessageView {
    readonly name: string;
    readonly value: JsonValue;
}
export interface ExtensionInteractionActionView {
    readonly id: string;
    readonly label: string;
    readonly tone?: 'primary' | 'secondary' | 'danger';
}
export interface ExtensionInteractionView {
    readonly id: string;
    readonly kind: string;
    readonly customType: string;
    readonly payload?: JsonValue;
    readonly title: string;
    readonly description?: string;
    readonly state: 'pending' | 'submitted' | 'cancelled' | 'expired';
    readonly actions: readonly ExtensionInteractionActionView[];
}
export interface ExtensionStatusView {
    readonly label: string;
    readonly detail?: string;
    readonly tone: 'neutral' | 'running' | 'success' | 'warning' | 'error';
}
export interface ExtensionTranscriptView {
    readonly sessionId: string | null;
    readonly projectPaths: readonly string[];
    readonly messageCount: number;
    readonly state: 'empty' | 'active';
}
export type ExtensionAgentLoopSurfaceInput = {
    readonly surface: 'tool';
    readonly toolCall: ChatToolCallPart;
    readonly toolResult?: ExtensionToolResultView;
} | {
    readonly surface: 'custom-message';
    readonly message: ExtensionCustomMessageView;
} | {
    readonly surface: 'interaction';
    readonly interaction: ExtensionInteractionView;
    readonly onAction?: (interactionId: string, actionId: string, payload?: JsonValue) => void;
} | {
    readonly surface: 'status';
    readonly status: ExtensionStatusView;
} | {
    readonly surface: 'transcript';
    readonly transcript: ExtensionTranscriptView;
};
export declare function surfaceTarget(input: ExtensionAgentLoopSurfaceInput): ExtensionAgentLoopTarget;
export declare function surfacePayload(input: ExtensionAgentLoopSurfaceInput): JsonObject;
export declare function surfaceLabel(input: ExtensionAgentLoopSurfaceInput): `Tool output \u00B7 ${string}` | `Custom message \u00B7 ${string}` | `Interaction \u00B7 ${string}` | "Transcript summary" | "Run status";
export declare function surfaceFamily(input: ExtensionAgentLoopSurfaceInput): "transcriptRenderers" | "toolRenderers" | "customMessageRenderers" | "interactionRenderers" | "statusWidgets";
