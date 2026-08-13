import type { WaggleStopCondition } from '@shared/types/waggle';
interface CollaborationSettingsCardProps {
    stopCondition: WaggleStopCondition;
    maxTurns: number;
    onStopConditionChange: (stopCondition: WaggleStopCondition) => void;
    onMaxTurnsChange: (maxTurns: number) => void;
}
export declare function CollaborationSettingsCard({ stopCondition, maxTurns, onStopConditionChange, onMaxTurnsChange, }: CollaborationSettingsCardProps): import("node_modules/@types/react").JSX.Element;
export {};
