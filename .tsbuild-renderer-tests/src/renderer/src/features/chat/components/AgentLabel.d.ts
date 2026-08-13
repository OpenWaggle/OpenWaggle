import { type SupportedModelId } from '@shared/types/llm';
import type { WaggleInfo } from './AssistantMessageBubble';
interface AgentLabelProps {
    assistantModel?: SupportedModelId;
    waggle?: WaggleInfo;
}
export declare function AgentLabel({ assistantModel, waggle }: AgentLabelProps): import("node_modules/@types/react").JSX.Element | null;
export {};
