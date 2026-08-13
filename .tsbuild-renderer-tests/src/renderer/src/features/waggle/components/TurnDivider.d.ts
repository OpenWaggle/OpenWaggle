import { type SupportedModelId } from '@shared/types/llm';
import type { WaggleAgentColor } from '@shared/types/waggle';
interface TurnDividerProps {
    turnNumber: number;
    agentLabel: string;
    agentColor: WaggleAgentColor;
    agentModel?: SupportedModelId;
}
export declare function TurnDivider({ turnNumber, agentLabel, agentColor, agentModel }: TurnDividerProps): import("node_modules/@types/react").JSX.Element;
export {};
