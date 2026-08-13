import type { ProviderInfo } from '@shared/types/llm';
import type { Settings } from '@shared/types/settings';
import { type WaggleAgentSlot } from '@shared/types/waggle';
import type { WaggleFormAction } from '../../hooks/useWaggleForm';
interface WaggleAgentSlotCardProps {
    index: 0 | 1;
    agent: WaggleAgentSlot;
    dispatchForm: (action: WaggleFormAction) => void;
    dotLabel: string;
    settings: Settings;
    providerModels: ProviderInfo[];
}
export declare function WaggleAgentSlotCard({ index, agent, dispatchForm, dotLabel, settings, providerModels, }: WaggleAgentSlotCardProps): import("node_modules/@types/react").JSX.Element;
export {};
